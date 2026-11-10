import { assetIdSchema, type AssetId } from '@canvas/schema';

import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { findScannedItem, isScannedItemDeleted } from './scanned-item-lookup.js';
import { ScannedPlacements } from './scanned-placements.js';
import { readScannedValue } from './scanned-value.js';
import {
  NO_CLIENT,
  scanUpdate,
  Y_MAP_TYPE,
  type ScannedItem,
  type UpdateScan,
} from './update-scan.js';

// Which assets a board uses, read straight from its encoded state: the relay records
// them when it snapshots a board, so the assets service can collect the unused ones.
// Decoding the board costs seconds at 50k objects (README, "Load"), so this
// reads only the two groups of an object's map that hold its type and its asset ids: `identity`
// and `style` (codec/object-layout.ts, the one layout since). Everything else, the
// `meta` map's layout stamp included, is skipped by the scan.

/** The keys of an object's map that hold its type and its asset ids. */
const RELEVANT_KEYS: ReadonlySet<string> = new Set(['identity', 'style']);

/** Where a map entry sits: its parent (a top-level name or a nested type's item) and key. */
interface Placement {
  readonly parentName: string | undefined;
  readonly parentItem: ScannedItem | undefined;
  readonly key: string | undefined;
}

/**
 * Finds an item's parent and key, from the item its chain of neighbours ends on
 * (`ScannedPlacements`): one step per earlier value of a key, remembered across items.
 *
 * @param scan - The scanned update.
 * @param placements - The scan's remembered chain ends.
 * @param item - The item.
 * @returns The placement, or undefined when the chain leaves the scanned items (a partial
 *   update) or loops (a malformed update).
 */
function placementOf(
  scan: UpdateScan,
  placements: ScannedPlacements,
  item: ScannedItem,
): Placement | undefined {
  const end = placements.endOf(item);
  if (end.kind !== 'root') return undefined;
  const { root } = end;
  return {
    parentName: root.parentName,
    parentItem:
      root.parentClient === NO_CLIENT
        ? undefined
        : findScannedItem(scan, root.parentClient, root.parentClock),
    key: root.parentSub,
  };
}

/**
 * Reads a field of a plain value when the value is an object.
 *
 * @param value - The value.
 * @param field - The field's name.
 * @returns The field's value, or undefined.
 */
function fieldOf(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Readonly<Record<string, unknown>>)[field];
}

/**
 * Collects the live entries under the relevant keys of every live object map, without reading
 * their values yet.
 *
 * @param scan - The scanned update.
 * @returns Each live object's relevant entries by key, by the object map's item.
 */
function collectEntries(scan: UpdateScan): Map<ScannedItem, Map<string, ScannedItem>> {
  const placements = new ScannedPlacements(scan);
  const isObjectMap = new Map<ScannedItem, boolean>();
  const objects = new Map<ScannedItem, Map<string, ScannedItem>>();
  for (const items of scan.items.values()) {
    for (const item of items) {
      if (item.content !== 'any' || isScannedItemDeleted(scan, item)) continue;
      const placement = placementOf(scan, placements, item);
      const objectItem = placement?.parentItem;
      const key = placement?.key;
      if (objectItem === undefined || key === undefined || !RELEVANT_KEYS.has(key)) continue;
      let isObject = isObjectMap.get(objectItem);
      if (isObject === undefined) {
        isObject =
          objectItem.content === 'type' &&
          objectItem.detail === Y_MAP_TYPE &&
          !isScannedItemDeleted(scan, objectItem) &&
          placementOf(scan, placements, objectItem)?.parentName === OBJECTS_MAP_NAME;
        isObjectMap.set(objectItem, isObject);
      }
      if (!isObject) continue;
      const entries = objects.get(objectItem) ?? new Map<string, ScannedItem>();
      entries.set(key, item);
      objects.set(objectItem, entries);
    }
  }
  return objects;
}

/**
 * Reads the asset ids one object uses, from its relevant entries: its type first, then the asset
 * fields of an image or a video, or the asset of a shape's or frame's image paint.
 *
 * @param update - The update the entries were scanned from.
 * @param entries - The object's live entries by key.
 * @returns The candidate asset ids (unvalidated).
 */
function assetFieldsOf(update: Uint8Array, entries: ReadonlyMap<string, ScannedItem>): unknown[] {
  const type = fieldOf(readScannedValue(update, entries.get('identity')), 'type');
  if (type === 'shape' || type === 'frame') {
    // An image paint on a shape's fill or a frame's background uses its asset.
    const paint = fieldOf(
      readScannedValue(update, entries.get('style')),
      type === 'shape' ? 'fill' : 'background',
    );
    return fieldOf(paint, 'type') === 'image' ? [fieldOf(paint, 'assetId')] : [];
  }
  if (type !== 'image' && type !== 'video') return [];
  const style = readScannedValue(update, entries.get('style'));
  return type === 'image'
    ? [fieldOf(style, 'assetId')]
    : [fieldOf(style, 'assetId'), fieldOf(style, 'poster')];
}

/**
 * Detects nested override maps before retaining arbitrary path keys in a second scan. Ordinary
 * boards keep the existing narrow scan and its memory cost.
 *
 * @param scan - The narrow asset scan, which already retains shared-type entries.
 * @returns Whether live override maps may contain asset references.
 */
function hasOverrideMaps(scan: UpdateScan): boolean {
  const placements = new ScannedPlacements(scan);
  for (const items of scan.items.values()) {
    for (const item of items) {
      if (
        item.content === 'type' &&
        item.detail === Y_MAP_TYPE &&
        (item.parentSub === undefined || item.parentSub === 'overrides') &&
        !isScannedItemDeleted(scan, item) &&
        placementOf(scan, placements, item)?.key === 'overrides'
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Reads asset fields held by live path records under a live instance's overrides map.
 *
 * @param update - The full encoded document.
 * @param scan - Its scan with arbitrary path keys retained.
 * @param objects - Live object maps and their identity/style entries.
 * @returns Asset candidates, excluding deleted paths, retired values and unrelated maps.
 */
function overrideAssetFields(
  update: Uint8Array,
  scan: UpdateScan,
  objects: ReadonlyMap<ScannedItem, ReadonlyMap<string, ScannedItem>>,
): unknown[] {
  const placements = new ScannedPlacements(scan);
  const assets: unknown[] = [];
  for (const items of scan.items.values()) {
    for (const item of items) {
      if (item.content !== 'any' || isScannedItemDeleted(scan, item)) continue;
      const parent = placementOf(scan, placements, item)?.parentItem;
      if (
        parent?.content !== 'type' ||
        parent.detail !== Y_MAP_TYPE ||
        isScannedItemDeleted(scan, parent)
      ) {
        continue;
      }
      const field = placementOf(scan, placements, parent);
      if (field?.key !== 'overrides' || field.parentItem === undefined) continue;
      const identity = objects.get(field.parentItem)?.get('identity');
      if (fieldOf(readScannedValue(update, identity), 'type') !== 'instance') continue;
      assets.push(fieldOf(readScannedValue(update, item), 'assetId'));
    }
  }
  return assets;
}

/**
 * Lists the assets a board uses: the `assetId` of every image and video on it and the `poster`
 * of every video that has one, including image assets held only in instance overrides, read
 * from the board's encoded state without decoding the board. The
 * objects' `identity` and `style` groups and live override path records are read; deleted
 * objects and replaced values are skipped, and so is everything outside the objects map (the
 * layout stamp). A value that is not a valid asset id
 * (a peer that skipped validation) is left out. The relay calls this when it snapshots a board,
 * so the assets service knows which assets are still in use.
 *
 * @param state - The board's full state as one Yjs update (update format v1, as
 *   `Y.encodeStateAsUpdate` or `DocumentStore#encodeState` writes it); not mutated.
 * @returns The distinct asset ids, sorted.
 * @throws {RangeError} When the state holds content Yjs update format v1 does not define.
 * @throws {Error} When the state ends early (lib0's "Unexpected end of array").
 */
export function listAssetIds(state: Uint8Array): AssetId[] {
  const ids = new Set<AssetId>();
  let scan = scanUpdate(state, RELEVANT_KEYS);
  const hasOverrides = hasOverrideMaps(scan);
  if (hasOverrides) scan = scanUpdate(state, RELEVANT_KEYS, { shouldKeepEveryStruct: true });
  const objects = collectEntries(scan);
  for (const entries of objects.values()) {
    for (const candidate of assetFieldsOf(state, entries)) {
      const parsed = assetIdSchema.safeParse(candidate);
      if (parsed.success) ids.add(parsed.data);
    }
  }
  if (hasOverrides) {
    for (const candidate of overrideAssetFields(state, scan, objects)) {
      const parsed = assetIdSchema.safeParse(candidate);
      if (parsed.success) ids.add(parsed.data);
    }
  }
  return [...ids].sort();
}
