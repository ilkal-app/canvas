import * as Y from 'yjs';

import {
  findFreehandIssues,
  instanceObjectSchema,
  type BoardObject,
  type VariantAxis,
} from '@canvas/schema';

import type { DecodeIssue, FieldProblem } from './decode-issue.js';
import { deepFreeze } from './deep-freeze.js';
import { describeValue } from './describe-value.js';
import { fieldKindProblem } from './field-kinds.js';
import { readNetworkMap } from './network-codec.js';
import { visibleNetwork, type StoredNetwork } from './network-visibility.js';
import {
  IDENTITY_KEY,
  isOptionalField,
  isOptionalGroup,
  layoutOf,
  storedTypeOf,
  type FieldCodec,
  type ObjectLayout,
} from './object-layout.js';
import { tolerateStoredOptionalStyle } from './optional-style-tolerance.js';
import { orderedFields } from './ordered-fields.js';
import { readOverrideMap } from './override-codec.js';
import { tolerateStoredPaints } from './paint-tolerance.js';
import { readPair } from './pair-codec.js';
import { readPlacementPage } from './placement-page.js';
import { plainFieldProblem } from './plain-fields.js';
import { readPresetsMap } from './presets-codec.js';
import { readLabel, readRichText } from './rich-text-codec.js';
import { tolerateStoredShadow } from './shadow-tolerance.js';
import { tolerateStoredStrokeStyle } from './stroke-tolerance.js';

/** The result of reading one entry of the object map: the object, or why it cannot be read. */
export type DecodedObject = { readonly object: BoardObject } | { readonly issue: DecodeIssue };

/**
 * Own keys an object may lack: default constraints, an instance's selection or a
 * main's presets when it has none, and a slot's swap options. A decoded
 * object leaves them out when absent.
 */
const OPTIONAL_KEYS: ReadonlySet<string> = new Set([
  'constraints',
  'variant',
  'variantPresets',
  'swapOptions',
]);

/**
 * Whether an optional own key holds a value a peer wrote malformed, which is skipped on its own so
 * the rest of the object still reads (a slot's swap options).
 *
 * @param key - The own key.
 * @param value - Its stored value.
 * @returns Whether to read the object without it.
 */
function isSkippedValue(key: string, value: unknown): boolean {
  return key === 'swapOptions' && !instanceObjectSchema.shape.swapOptions.safeParse(value).success;
}

/**
 * Reads a group's fields into the object being built.
 *
 * @param value - The stored group value.
 * @param key - The group's key.
 * @param fields - The fields the group holds.
 * @param target - The object being built.
 * @param layout - The layout of the object's type, for which fields may be left out.
 * @returns `null` on success, else the field at fault and why.
 */
function readGroup(
  value: unknown,
  key: string,
  fields: readonly string[],
  target: Record<string, unknown>,
  layout: ObjectLayout,
): FieldProblem | null {
  if (typeof value !== 'object' || value === null || value instanceof Y.AbstractType) {
    return { field: key, message: 'the group is not a plain object', isMissing: false };
  }
  const group = value as Readonly<Record<string, unknown>>;
  for (const field of fields) {
    // An optional field the object leaves out is not stored: a placement stored before layout 4
    // has no page (`placement-page.ts`), a frame without `showName` keeps its default.
    if (!(field in group) && isOptionalField(layout, field)) continue;
    if (!(field in group)) return { field, message: `missing from ${key}`, isMissing: true };
    target[field] = group[field];
  }
  if (key === 'placement') readPlacementPage(target);
  return null;
}

/**
 * Reads one field, or group of fields, of the grouped layout into the object being built.
 *
 * @param map - The object's map.
 * @param codec - How the field is stored.
 * @param target - The object being built.
 * @param layout - The layout of the object's type.
 * @returns `null` on success, else the field at fault and why.
 */
function readField(
  map: Y.Map<unknown>,
  codec: FieldCodec,
  target: Record<string, unknown>,
  layout: ObjectLayout,
): FieldProblem | null {
  if (codec.kind === 'inline-text') {
    const content = readRichText(map);
    if (typeof content === 'string') return { field: 'text', message: content, isMissing: false };
    target.text = content.text;
    target.runs = content.runs;
    if (content.paragraphs !== undefined) target.paragraphs = content.paragraphs;
    return null;
  }
  if (codec.kind === 'pair') return readPair(map, codec, target);
  if (codec.kind === 'stroke-data') {
    // A stroke without pressures stores no `strokePressures`.
    if (!map.has(codec.key)) {
      return codec.field === 'pressures'
        ? null
        : { field: codec.field, message: 'missing', isMissing: true };
    }
    target[codec.field] = map.get(codec.key);
    return null;
  }
  if (OPTIONAL_KEYS.has(codec.key) && !map.has(codec.key)) return null;
  if (!map.has(codec.key)) {
    // A group of optional fields only is stored once one is set (an instance's or main's
    // `style`, which holds `colorMode`), so objects stored before it read as the empty group.
    if (codec.kind === 'group' && isOptionalGroup(layout, codec.fields)) return null;
    return { field: codec.key, message: 'missing', isMissing: true };
  }
  const value = map.get(codec.key);
  if (codec.kind === 'group') {
    return readGroup(value, codec.key, codec.fields, target, layout);
  }
  if (codec.kind === 'plain') {
    if (isSkippedValue(codec.key, value)) return null;
    target[codec.key] = value;
    return null;
  }
  const read =
    codec.kind === 'overrides'
      ? readOverrideMap(value)
      : codec.kind === 'presets'
        ? readPresetsMap(value, target.variantAxes as readonly VariantAxis[] | undefined)
        : codec.kind === 'label'
          ? readLabel(value)
          : readNetworkMap(value);
  if (typeof read === 'string') return { field: codec.key, message: read, isMissing: false };
  // Presets with no axes to use them read as none, the key left out (`readPresetsMap`).
  if (read === undefined) return null;
  target[codec.key] = read;
  return null;
}

/**
 * Builds a decode issue.
 *
 * @param key - The entry's key.
 * @param code - The issue code.
 * @param field - The field at fault, or `null`.
 * @param message - The description.
 * @returns The failed decode result.
 */
function failure(
  key: string,
  code: DecodeIssue['code'],
  field: string | null,
  message: string,
): DecodedObject {
  return { issue: { code, key, field, message } };
}

/**
 * Reads the fields of an object stored in the grouped layout into `target`.
 *
 * @param map - The object's map.
 * @param layout - The layout of its stored type.
 * @param target - The object being built.
 * @returns `null` on success, else the field at fault.
 */
function readGroupedObject(
  map: Y.Map<unknown>,
  layout: ObjectLayout,
  target: Record<string, unknown>,
): FieldProblem | null {
  for (const codec of layout.codecs) {
    const problem = readField(map, codec, target, layout);
    if (problem !== null) return problem;
  }
  const plainProblem = plainFieldProblem(target);
  if (plainProblem !== null) return plainProblem;
  tolerateStoredPaints(target);
  tolerateStoredShadow(target);
  tolerateStoredStrokeStyle(target);
  tolerateStoredOptionalStyle(target);
  return fieldKindProblem(layout.kinds, target);
}

/**
 * Converts an entry of the document's object map back to a board object, rebuilding text runs
 * from the `Y.Text` delta. Field values are not validated against the schema (ranges, nested
 * shapes): remote updates are trusted at this layer (see the README), and the store validates
 * every local write. Two things are checked, because code would throw on what fails them: no
 * plain field may reach a shared type, binary data, a bigint or a container JavaScript cannot
 * convert (`plain-fields.ts`), and each known field's top-level kind must be one its schema
 * accepts (`field-kinds.ts`). A refused gradient reads as no fill (`paint-tolerance.ts`), a refused
 * drop shadow as none (`shadow-tolerance.ts`), a refused stroke alignment as inside and a refused
 * frame outline as none (`stroke-tolerance.ts`), a refused frame radius as sharp, a refused
 * layer opacity as opaque and a refused visibility as shown (`optional-style-tolerance.ts`). A
 * path's network is read with the rules merges can break applied
 * (`network-visibility.ts`). What cannot be read at all is reported, never thrown.
 *
 * @param key - The entry's key in the object map.
 * @param value - The entry's value.
 * @returns The object, deep-frozen, with its fields in schema order, or the issue that stopped
 *   the read.
 */
export function fromYjs(key: string, value: unknown): DecodedObject {
  if (!(value instanceof Y.Map)) return failure(key, 'not-a-map', null, 'the entry is not a Y.Map');
  const map = value as Y.Map<unknown>;
  const type = storedTypeOf(map);
  const layout = layoutOf(type);
  if (layout === undefined) {
    if (plainFieldProblem({ type }) !== null) {
      return failure(
        key,
        'malformed-field',
        IDENTITY_KEY,
        'the type contains a shared, binary, bigint or unconvertible value',
      );
    }
    return failure(key, 'unknown-type', IDENTITY_KEY, `unknown object type ${describeValue(type)}`);
  }
  const fields: Record<string, unknown> = {};
  const problem = readGroupedObject(map, layout, fields);
  if (problem !== null) {
    const code = problem.isMissing ? 'missing-field' : 'malformed-field';
    return failure(key, code, problem.field, `${problem.field}: ${problem.message}`);
  }
  if (fields.id !== key) {
    return failure(
      key,
      'id-mismatch',
      'id',
      `the stored id ${describeValue(fields.id)} is not the key`,
    );
  }
  if (layout.codecs.some(({ kind }) => kind === 'network')) {
    // The network rules merges can break are applied here, on read (`network-visibility.ts`).
    const visible = visibleNetwork(fields as unknown as StoredNetwork);
    fields.vertices = visible.vertices;
    fields.segments = visible.segments;
  }
  if (fields.type === 'freehand') {
    // A stroke's point rule reads both arrays, which merge apart: checked on read.
    const issues = findFreehandIssues(
      fields.points as readonly number[],
      fields.pressures as readonly number[] | undefined,
    );
    if (issues.length > 0)
      return failure(key, 'malformed-field', 'points', `points: ${issues.join(' ')}`);
  }
  const object = orderedFields(layout.fieldNames, fields);
  // Optional fields few objects store are left out when absent, as stored, so a decoded object
  // has the keys its writer gave it (`constraints`; a box's `layoutChild`; an
  // unnamed object's `name`; an opaque layer's `opacity`; a shown layer's
  // `isHidden`; an auto-direction text's `direction`; a square sticky's
  // `aspect`; a stroke's `pressures` when its device reported none; an
  // unlinked object's `link`; an image's `border` when it has none; a
  // connector's `labelPosition` at the midpoint; a connector's `elbowMiddle` and
  // `curvePoint` while it routes automatically; a text's or sticky's `paragraphs` while
  // every paragraph is plain).
  const optional = [...OPTIONAL_KEYS, 'layoutChild', 'name', 'opacity', 'isHidden', 'direction'];
  const handles = ['labelPosition', 'elbowMiddle', 'curvePoint'];
  const text = ['paragraphs'];
  for (const key of [...optional, 'aspect', 'pressures', 'link', 'border', ...handles, ...text]) {
    if (!(key in fields)) Reflect.deleteProperty(object, key);
  }
  return { object: deepFreeze(object) as BoardObject };
}
