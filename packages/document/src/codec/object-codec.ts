import * as Y from 'yjs';

import type { BoardObject, TextContent } from '@canvas/schema';

import { createNetworkMap, syncNetworkMap, type NetworkItem } from './network-codec.js';
import { collectedSegments } from './network-collection.js';
import { hiddenMembers, wouldDeleteMembers, type HiddenMembers } from './network-visibility.js';
import { isOptionalGroup, layoutOf, type FieldCodec, type ObjectLayout } from './object-layout.js';
import { carryRefusedOptionalStyle } from './optional-style-tolerance.js';
import { createOverrideMap, writeOverrideMap } from './override-codec.js';
import { pairEntries, writePair } from './pair-codec.js';
import { isSamePlacement } from './placement-page.js';
import { setIfChanged } from './plain-value.js';
import { createPresetsMap, writePresetsMap } from './presets-codec.js';
import { createRichTextEntries, writeLabel, writeRichText } from './rich-text-codec.js';
import { carryRefusedShadow } from './shadow-tolerance.js';
import { carryRefusedStrokeStyle } from './stroke-tolerance.js';

/**
 * Reads a field of a validated object by name.
 *
 * @param object - The object.
 * @param key - A field name from the object's layout.
 * @returns The field's value.
 */
function fieldOf(object: BoardObject, key: string): unknown {
  return (object as unknown as Readonly<Record<string, unknown>>)[key];
}

/**
 * Own keys stored only when their optional field is set (an instance's selection and a
 * main's presets: a slot's swap options).
 */
const OPTIONAL_OWN_KEYS: ReadonlySet<string> = new Set([
  'variant',
  'variantPresets',
  'swapOptions',
]);

/**
 * Whether an own-key field needs no stored key: default constraints (preserving older read
 * shapes), or an optional field left unset.
 *
 * @param object - The validated object.
 * @param key - Its codec key.
 * @returns Whether to omit or remove this key.
 */
function isOmittedOwnField(object: BoardObject, key: string): boolean {
  if (OPTIONAL_OWN_KEYS.has(key)) return fieldOf(object, key) === undefined;
  if (key !== 'constraints') return false;
  const value = object.constraints;
  return value === undefined || (value.x === 'start' && value.y === 'start');
}

/**
 * Reads the body text of a text object or sticky, which the schema holds as two top-level
 * fields.
 *
 * @param object - A validated text object or sticky.
 * @returns Its text and runs.
 */
function inlineTextOf(object: BoardObject): TextContent {
  const paragraphs = fieldOf(object, 'paragraphs');
  return {
    text: fieldOf(object, 'text'),
    runs: fieldOf(object, 'runs'),
    ...(paragraphs === undefined ? {} : { paragraphs }),
  } as TextContent;
}

/**
 * Builds the plain value of a group from an object's fields.
 *
 * @param object - The validated object.
 * @param fields - The group's fields.
 * @returns A new plain object holding those fields, in order.
 */
function groupValueOf(object: BoardObject, fields: readonly string[]): Record<string, unknown> {
  // An optional field the object lacks (a `pageId` not yet given) is left out, not stored as
  // `undefined`.
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = fieldOf(object, field);
      return value === undefined ? [] : [[field, value]];
    }),
  );
}

/**
 * Whether a group holds only optional fields and none is set (an instance's or main's `style`
 * before it has a `colorMode`): such a group is not created, so an object is stored as
 * a layout 8 build stored it until a field is set.
 *
 * @param object - The validated object.
 * @param fields - The group's fields.
 * @param value - The group's value.
 * @returns `true` when the group need not be stored.
 */
function isUnsetOptionalGroup(
  object: BoardObject,
  fields: readonly string[],
  value: Readonly<Record<string, unknown>>,
): boolean {
  if (Object.keys(value).length > 0) return false;
  const layout = layoutOf(object.type);
  return layout !== undefined && isOptionalGroup(layout, fields);
}

/** No member is hidden: the network is whole, or nothing would be deleted. */
const NOTHING_HIDDEN: HiddenMembers = Object.freeze({
  vertices: new Set<unknown>(),
  segments: new Set<unknown>(),
});

/**
 * The ids of an object's network list.
 *
 * @param object - The validated object.
 * @param key - The network field.
 * @returns The ids it lists.
 */
function listedIds(object: BoardObject, key: string): Set<string> {
  return new Set((fieldOf(object, key) as readonly NetworkItem[]).map(({ id }) => id));
}

/**
 * The keys of a stored map that are neither listed nor hidden: the members a write deletes that
 * a read showed.
 *
 * @param map - The stored network map.
 * @param listed - The ids the write lists.
 * @param hidden - The ids a read leaves out.
 * @returns Those keys.
 */
function deletedShown(
  map: Y.Map<unknown>,
  listed: ReadonlySet<string>,
  hidden: ReadonlySet<unknown>,
): Set<string> {
  return new Set([...map.keys()].filter((id) => !listed.has(id) && !hidden.has(id)));
}

/**
 * The network members a write of an object must keep although the object does not list them:
 * those a read leaves out (`network-visibility.ts`), less the segments the write collects
 * (`network-collection.ts`). Read from the map as stored before the write, and only when the
 * write would delete a member (a move deletes none; a hidden member waiting for a vertex id the
 * write creates is one the write does not list, so it counts).
 *
 * @param map - The object's map, as stored.
 * @param layout - The layout of its type.
 * @param object - The validated object about to be written.
 * @returns The hidden members to keep, per list.
 */
function membersToKeep(
  map: Y.Map<unknown>,
  layout: ObjectLayout,
  object: BoardObject,
): HiddenMembers {
  if (!layout.codecs.some(({ kind }) => kind === 'network')) return NOTHING_HIDDEN;
  const vertices = map.get('vertices');
  const segments = map.get('segments');
  if (!(vertices instanceof Y.Map) || !(segments instanceof Y.Map)) return NOTHING_HIDDEN;
  const vertexIds = listedIds(object, 'vertices');
  const segmentIds = listedIds(object, 'segments');
  if (!wouldDeleteMembers(vertices, vertexIds) && !wouldDeleteMembers(segments, segmentIds)) {
    return NOTHING_HIDDEN;
  }
  const hidden = hiddenMembers(map);
  const vertexMap = vertices as Y.Map<unknown>;
  const segmentMap = segments as Y.Map<unknown>;
  const collected = collectedSegments(segmentMap, {
    deletedVertexIds: deletedShown(vertexMap, vertexIds, hidden.vertices),
    createdVertexIds: new Set([...vertexIds].filter((id) => !vertexMap.has(id))),
    deletedSegmentIds: deletedShown(segmentMap, segmentIds, hidden.segments),
    writtenSegmentIds: segmentIds,
    storedVertexIds: vertexMap,
  });
  if (collected.size === 0) return hidden;
  const kept = new Set([...hidden.segments].filter((id) => !collected.has(String(id))));
  return { vertices: hidden.vertices, segments: kept };
}

/**
 * Writes one field, or group of fields, of an object into its map by its codec.
 *
 * @param map - The object's map.
 * @param codec - How the field is stored.
 * @param object - The validated object holding the new values.
 * @param hidden - The network members to keep (see {@link membersToKeep}).
 * @param removed - The optional fields the write removes explicitly (see {@link writeObject}).
 */
function writeField(
  map: Y.Map<unknown>,
  codec: FieldCodec,
  object: BoardObject,
  hidden: HiddenMembers,
  removed: ReadonlySet<string>,
): void {
  switch (codec.kind) {
    case 'group': {
      const value = groupValueOf(object, codec.fields);
      if (!map.has(codec.key) && isUnsetOptionalGroup(object, codec.fields, value)) return;
      // A stored shadow the reader left out as refused is kept (`shadow-tolerance.ts`).
      if (codec.fields.includes('shadow')) carryRefusedShadow(value, map.get(codec.key));
      // So are a refused stroke alignment, frame outline and image border (`stroke-tolerance.ts`).
      if (codec.key === 'style') carryRefusedStrokeStyle(value, map.get(codec.key));
      // And a frame's refused corner radius and a layer's refused opacity
      // (`optional-style-tolerance.ts`). An explicit removal wins over a refused stored value.
      carryRefusedOptionalStyle(value, codec.fields, map.get(codec.key), removed);
      if (
        codec.key === 'placement' &&
        map.has(codec.key) &&
        isSamePlacement(map.get(codec.key), value)
      ) {
        return;
      }
      setIfChanged(map, codec.key, value);
      return;
    }
    case 'plain':
      if (isOmittedOwnField(object, codec.key)) {
        map.delete(codec.key);
        return;
      }
      setIfChanged(map, codec.key, fieldOf(object, codec.key));
      return;
    case 'stroke-data': {
      const value = fieldOf(object, codec.field);
      if (value === undefined) map.delete(codec.key);
      else setIfChanged(map, codec.key, value);
      return;
    }
    case 'pair':
      writePair(map, codec, fieldOf(object, codec.key) as readonly [unknown, unknown]);
      return;
    case 'inline-text':
      writeRichText(map, inlineTextOf(object));
      return;
    case 'label':
      writeLabel(map, codec.key, fieldOf(object, codec.key) as TextContent | null);
      return;
    case 'overrides': {
      const records = fieldOf(object, codec.key) as Readonly<Record<string, unknown>>;
      const existing = map.get(codec.key);
      if (existing instanceof Y.Map) writeOverrideMap(existing as Y.Map<unknown>, records);
      else map.set(codec.key, createOverrideMap(records));
      return;
    }
    case 'presets': {
      if (isOmittedOwnField(object, codec.key)) {
        map.delete(codec.key);
        return;
      }
      const presets = fieldOf(object, codec.key) as Parameters<typeof createPresetsMap>[0];
      const existing = map.get(codec.key);
      if (existing instanceof Y.Map) writePresetsMap(existing as Y.Map<unknown>, presets);
      else map.set(codec.key, createPresetsMap(presets));
      return;
    }
    case 'network': {
      const items = fieldOf(object, codec.key) as readonly NetworkItem[];
      const existing = map.get(codec.key);
      const kept = codec.key === 'vertices' ? hidden.vertices : hidden.segments;
      if (existing instanceof Y.Map) syncNetworkMap(existing as Y.Map<unknown>, items, kept);
      else map.set(codec.key, createNetworkMap(items));
      return;
    }
  }
}

/**
 * Writes an object into its stored map, setting only what differs from what is stored: groups
 * and keys whose value changed (for a pair, each member on its own), a minimal edit of rich text, a sync of vector networks by member
 * id. A group is written whole whenever any of its fields changed, so a move writes the whole
 * placement (`parentId` included) and a reparent the whole placement too. Writing the same
 * object twice changes nothing, and concurrent edits to the fields and groups left alone
 * survive. Network members a read leaves out are kept (`network-visibility.ts`), less those the
 * write collects (`network-collection.ts`), and so is a stored drop shadow the reader left out as
 * refused, unless the write sets one (`shadow-tolerance.ts`), and likewise a refused
 * stroke alignment or frame outline (`stroke-tolerance.ts`) or frame radius or
 * layer opacity (`optional-style-tolerance.ts`), unless the write removes it
 * (`removed`). The caller
 * validates `object` first and runs this inside a transaction; `object.type` must equal the
 * stored type.
 *
 * @param map - The object's map, integrated in a document (for a new object, use `toYjs`).
 * @param object - The validated object.
 * @param removed - The optional fields the write removes explicitly (a patch that gives them as
 *   `undefined`): a refused stored value of one is not carried through (a frame's
 *   `cornerRadius`: a layer's `opacity`; removals leave them out rather than writing
 *   `null`). None by default.
 * @throws {RangeError} When `object.type` is not a known object type.
 */
export function writeObject(
  map: Y.Map<unknown>,
  object: BoardObject,
  removed: ReadonlySet<string> = NO_REMOVALS,
): void {
  const layout = layoutOf(object.type);
  if (layout === undefined) throw new RangeError(`Unknown object type "${object.type}"`);
  const hidden = membersToKeep(map, layout, object);
  for (const codec of layout.codecs) writeField(map, codec, object, hidden, removed);
}

/** No field removed explicitly: an unrelated write, which carries refused stored values. */
const NO_REMOVALS: ReadonlySet<string> = new Set();

/**
 * Builds the entries of one field, or group of fields, for a new object map, reading nothing.
 *
 * @param codec - How the field is stored.
 * @param object - The validated object.
 * @returns The field's entries: one per key it occupies.
 */
function fieldEntries(codec: FieldCodec, object: BoardObject): [string, unknown][] {
  switch (codec.kind) {
    case 'group': {
      const value = groupValueOf(object, codec.fields);
      return isUnsetOptionalGroup(object, codec.fields, value) ? [] : [[codec.key, value]];
    }
    case 'plain':
      if (isOmittedOwnField(object, codec.key)) return [];
      return [[codec.key, fieldOf(object, codec.key)]];
    case 'stroke-data': {
      const value = fieldOf(object, codec.field);
      return value === undefined ? [] : [[codec.key, value]];
    }
    case 'pair':
      return pairEntries(codec, fieldOf(object, codec.key) as readonly [unknown, unknown]);
    case 'inline-text':
      return createRichTextEntries(inlineTextOf(object));
    case 'label': {
      const label = fieldOf(object, codec.key) as TextContent | null;
      return [[codec.key, label === null ? null : new Y.Map(createRichTextEntries(label))]];
    }
    case 'network':
      return [[codec.key, createNetworkMap(fieldOf(object, codec.key) as readonly NetworkItem[])]];
    case 'overrides':
      return [
        [
          codec.key,
          createOverrideMap(fieldOf(object, codec.key) as Readonly<Record<string, unknown>>),
        ],
      ];
    case 'presets':
      if (isOmittedOwnField(object, codec.key)) return [];
      return [
        [
          codec.key,
          createPresetsMap(fieldOf(object, codec.key) as Parameters<typeof createPresetsMap>[0]),
        ],
      ];
  }
}

/**
 * Converts a validated object to its Yjs representation in the grouped layout
 * (`object-layout.ts`). The map is not yet in a document; insert it into the object map inside
 * a transaction.
 *
 * @param object - The validated object; not modified. Plain field values are stored by
 *   reference, so pass a value the caller owns (the store passes the schema's parse output).
 * @returns A new `Y.Map` for the object.
 * @throws {RangeError} When `object.type` is not a known object type.
 */
export function toYjs(object: BoardObject): Y.Map<unknown> {
  const layout = layoutOf(object.type);
  if (layout === undefined) throw new RangeError(`Unknown object type "${object.type}"`);
  return new Y.Map<unknown>(layout.codecs.flatMap((codec) => fieldEntries(codec, object)));
}

export { fromYjs, type DecodedObject } from './object-reader.js';
