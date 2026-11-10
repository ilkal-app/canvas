import { hasGeometry, type BoardObject, type ComponentObject, type ObjectId } from '@canvas/schema';

import { equalOverrides } from './equal-overrides.js';

// What instance resolution reads of a main, so the expansion can tell an edit
// that changes instances from one that does not, and a preset edit from any other.

/**
 * Main keys by object: an object is an immutable snapshot, so its key never changes, and a
 * thousand instances of one main serialise its presets once, not a thousand times.
 */
const mainKeys = new WeakMap<BoardObject, string>();

/**
 * Summarises the fields of a referenced main that resolution reads: its placement, rotation,
 * stacking and name never reach an instance, so editing only those re-resolves nothing.
 *
 * @param main - The referenced object, if it exists.
 * @returns A key that changes exactly when resolution may change.
 */
export function mainKey(main: BoardObject | undefined): string {
  if (main === undefined) return '';
  if (main.type !== 'component') return main.type;
  let key = mainKeys.get(main);
  if (key === undefined) {
    // A main's colour mode and opacity reach every instance that sets none;
    // its variant axes and presets reach every instance, which shows the presets of the values it
    // selects; and its auto-layout places every instance's children.
    key = JSON.stringify([
      main.retired,
      main.width,
      main.height,
      main.colorMode ?? null,
      main.opacity ?? null,
      main.variantAxes ?? null,
      main.variantPresets ?? null,
      main.autoLayout ?? null,
    ]);
    mainKeys.set(main, key);
  }
  return key;
}

/**
 * The children a main edit changed when only its presets changed: the paths whose
 * records differ in any preset. A preset edit is then an edit of those children, which the
 * instances of the main patch as they patch a child edit.
 *
 * @param before - The main as last resolved.
 * @param after - The main now.
 * @returns The changed child ids, or `undefined` when anything else changed, a nested path did, or
 *   a changed record holds geometry or is the variant's own.
 */
export function presetEdits(
  before: BoardObject | undefined,
  after: BoardObject | undefined,
): Set<ObjectId> | undefined {
  if (before?.type !== 'component' || after?.type !== 'component') return undefined;
  const rest = (main: ComponentObject) => mainKey({ ...main, variantPresets: undefined });
  if (rest(before) !== rest(after)) return undefined;
  const presets = [before.variantPresets ?? {}, after.variantPresets ?? {}];
  const keys = new Set(presets.flatMap((all) => Object.keys(all)));
  const edits = new Set<ObjectId>();
  for (const key of keys) {
    const [old, next] = presets.map((all) => all[key] ?? {});
    for (const path of new Set([...Object.keys(old ?? {}), ...Object.keys(next ?? {})])) {
      if (equalOverrides(old?.[path], next?.[path])) continue;
      if (path.includes('/')) return undefined;
      // A variant's size, or a record that moves or sizes a child or patches a layout before or
      // after, places other copies too: only a full resolution can.
      if (path === after.id || hasGeometry(old?.[path]) || hasGeometry(next?.[path])) {
        return undefined;
      }
      edits.add(path as ObjectId);
    }
  }
  return edits;
}

/** Record fields that paint a child without moving or sizing anything. */
const PAINT_FIELDS = ['fill', 'strokeColor', 'color'] as const;

/**
 * A record without its paint fields: what a layout can read of it.
 *
 * @param record - A preset record, if any.
 * @returns The record less `fill`, `strokeColor` and `color`; undefined when nothing else is left.
 */
function layoutPart(record: object | undefined): object | undefined {
  if (record === undefined) return undefined;
  const rest: Record<string, unknown> = { ...record };
  for (const field of PAINT_FIELDS) Reflect.deleteProperty(rest, field);
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/**
 * Whether a preset edit only repaints: every changed record differs in `fill`,
 * `strokeColor` or `color` alone, so no copy moves or resizes, even in an auto-layout main, and
 * the instances may patch the recoloured children without laying out again.
 *
 * @param before - The main as last resolved.
 * @param after - The main now.
 * @returns True when the presets differ in paint only; false for any other change.
 */
export function isPaintOnlyPresetEdit(
  before: BoardObject | undefined,
  after: BoardObject | undefined,
): boolean {
  if (before?.type !== 'component' || after?.type !== 'component') return false;
  const presets = [before.variantPresets ?? {}, after.variantPresets ?? {}];
  for (const key of new Set(presets.flatMap((all) => Object.keys(all)))) {
    const [old, next] = presets.map((all) => all[key] ?? {});
    for (const path of new Set([...Object.keys(old ?? {}), ...Object.keys(next ?? {})])) {
      if (!equalOverrides(layoutPart(old?.[path]), layoutPart(next?.[path]))) return false;
    }
  }
  return true;
}

/** The fields of an object a layout or a constraint reads, beyond its type, parent and z. */
const LAYOUT_FIELDS = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'constraints',
  'autoWidth',
  'layoutChild',
  'autoLayout',
] as const;

/** Layout reads by object, cached as {@link mainKeys} are: an object never changes. */
const layoutReads = new WeakMap<BoardObject, string>();

/**
 * Summarises what an instance's auto-layout can read of a definition object: its type,
 * parent, stacking, box, rotation, constraints, text sizing and layout fields. An edit that keeps
 * it (a recolour, new text content at the same size) moves no copy, so the expansion patches the
 * edited child instead of laying out every instance again.
 *
 * @param object - A definition object, if it exists.
 * @returns A key that changes whenever a layout may place anything differently.
 */
export function layoutRead(object: BoardObject | undefined): string {
  if (object === undefined) return '';
  let read = layoutReads.get(object);
  if (read === undefined) {
    const fields: Partial<Record<string, unknown>> = object;
    read = JSON.stringify([
      object.type,
      object.parentId,
      object.z,
      ...LAYOUT_FIELDS.map((field) => fields[field] ?? null),
    ]);
    layoutReads.set(object, read);
  }
  return read;
}
