import { isPageIdText } from '../ids/page-id.js';
import type { Crop } from '../objects/image-object.js';

import type { UndrawableReason } from './drawable-extent.js';
import {
  coordinateReason,
  cropExtentReason,
  cropReason,
  instanceScaleReason,
  naturalSizeReason,
  scalarReason,
  sizeReason,
  unitReason,
} from './drawable-ranges.js';
import type { DrawableValueKind } from './drawable-value-kinds.js';
import { curvePointValueReason, labelPositionValueReason } from './label-position-values.js';
import { linkValueReason } from './link-values.js';
import { objectNameValueReason } from './name-values.js';
import { paintReason, strokeValueReason, type PaintValueFinding } from './paint-values.js';
import { shadowValueReason } from './shadow-values.js';
import { StoredValueMatch, type StoredValueReader } from './stored-value-match.js';
import { strokeAlignValueReason } from './stroke-align-values.js';
import { numbersFinding } from './stroke-data-values.js';
import { strokeStyleReason } from './stroke-style-values.js';

// The door check of incoming values (part 1): the numbers one stored value carries,
// judged by the same ranges the engine's reader applies (`drawable-ranges.ts`), where the value
// arrives as anything a peer wrote. A judged field that is present must be a number, and a
// judged value or group a plain record: no command writes a string, an object or null there
// (fix round 1). A coordinate is held to finite only, as the engine's reader holds it
// (`coordinateReason`): its place on the board needs its parents, which the door does not see,
// and the command layer stores any finite coordinate whose place lands within the board's bound.
// A field written as the board already holds it is not judged (`StoredValueMatch`).

export type { DrawableValueKind } from './drawable-value-kinds.js';

/**
 * Why the door refuses a value: a number out of its range (`UndrawableReason`), a judged field
 * that is not a number (`not-a-number`), a judged value or group that is not a plain record, or
 * not a pair of them (`not-a-record`), a placement's `pageId` that is neither `null` nor an id
 * (`not-an-id`), or a frame's `showName` that is present and not a boolean
 * (`not-a-boolean`).
 */
export type DrawableValueReason =
  UndrawableReason | 'not-a-number' | 'not-a-record' | 'not-an-id' | 'not-a-boolean';

/** A field of a stored value the door refuses. */
export interface DrawableValueFinding {
  /** Where in the value, as a dotted path (`x`, `crop`, `naturalSize.width`, `1.y`, `ha.x`; `''` for the whole value). */
  readonly field: string;
  /** Why it is refused. */
  readonly reason: DrawableValueReason;
}

/** Judges one number. */
type NumberRule = (value: number) => UndrawableReason | undefined;

/** The rules of a record's number fields. */
type FieldRules = readonly (readonly [string, NumberRule])[];

const PLACEMENT: FieldRules = [
  ['x', coordinateReason],
  ['y', coordinateReason],
  ['rotation', scalarReason],
];
const SIZE: FieldRules = [
  ['width', sizeReason],
  ['height', sizeReason],
  ['scale', instanceScaleReason],
];
const POINT: FieldRules = [
  ['x', coordinateReason],
  ['y', coordinateReason],
];
const NATURAL_SIZE: FieldRules = [
  ['width', naturalSizeReason],
  ['height', naturalSizeReason],
];
/** A layer's or image's opacity, in [0, 1]; absent is opaque. */
const OPACITY: FieldRules = [['opacity', unitReason]];
const CROP: FieldRules = [
  ['x', unitReason],
  ['y', unitReason],
  ['width', cropExtentReason],
  ['height', cropExtentReason],
];

/**
 * Tells whether a value is a plain record (not null, not an array).
 *
 * @param value - Anything.
 * @returns True for a plain record.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Names a refused field, unless the write leaves it as the board holds it.
 *
 * @param match - The comparison with the stored value.
 * @param path - The field's path.
 * @param written - The written field.
 * @param reason - Why it would be refused.
 * @returns The finding, or undefined when the field is unchanged.
 */
function refuse(
  match: StoredValueMatch,
  path: readonly string[],
  written: unknown,
  reason: DrawableValueReason,
): DrawableValueFinding | undefined {
  return match.isUnchanged(path, written) ? undefined : { field: path.join('.'), reason };
}

/**
 * Judges a record and the number fields its rules cover. An absent field is the decoder's.
 *
 * @param value - The record, as written.
 * @param path - Its path within the written value.
 * @param rules - Each field's rule.
 * @param match - The comparison with the stored value.
 * @param isRequired - Whether an absent record is refused too (a nested group may be absent).
 * @returns The first finding, or undefined.
 */
function judgeRecord(
  value: unknown,
  path: readonly string[],
  rules: FieldRules,
  match: StoredValueMatch,
  isRequired = true,
): DrawableValueFinding | undefined {
  if (!isRecord(value)) {
    return value === undefined && !isRequired
      ? undefined
      : refuse(match, path, value, 'not-a-record');
  }
  for (const [name, rule] of rules) {
    const field = value[name];
    const reason =
      typeof field === 'number' ? rule(field) : field === undefined ? undefined : 'not-a-number';
    const finding =
      reason === undefined ? undefined : refuse(match, [...path, name], field, reason);
    if (finding !== undefined) return finding;
  }
  return undefined;
}

/**
 * The style fields judged as paints and strokes, layer names, links, borders,
 * label positions and a connector's handles.
 */
const PAINTED_FIELDS: readonly (readonly [
  string,
  (value: unknown) => PaintValueFinding | undefined,
])[] = [
  ['fill', paintReason],
  ['background', paintReason],
  ['stroke', strokeValueReason],
  // A shape's or frame's drop shadow.
  ['shadow', shadowValueReason],
  // A shape's or frame's stroke alignment; a frame's `stroke` is the `stroke` row's.
  ['strokeAlign', strokeAlignValueReason],
  // Any object's layer name: absent or a string of at most 200.
  ['name', objectNameValueReason],
  // A text's, sticky's or image's link: absent or a safe, normalised URL.
  ['link', linkValueReason],
  // An image's border: absent, null or a stroke, judged as a stroke is.
  ['border', strokeValueReason],
  // A connector's label position: absent or a fraction from 0 to 1.
  ['labelPosition', labelPositionValueReason],
  // A connector's route handles: a fraction as a label's, a point within the reach.
  ['elbowMiddle', labelPositionValueReason],
  ['curvePoint', curvePointValueReason],
];

/**
 * Judges a style group's paints and stroke, each when present. A field written as the board
 * holds it is not judged.
 *
 * @param style - The style value.
 * @param match - The comparison with the stored value.
 * @returns The first finding, or undefined.
 */
function paintedFinding(
  style: Readonly<Record<string, unknown>>,
  match: StoredValueMatch,
): DrawableValueFinding | undefined {
  for (const [name, judge] of PAINTED_FIELDS) {
    const value = style[name];
    const finding = judge(value);
    if (finding === undefined || match.isUnchanged([name], value)) continue;
    return {
      field: finding.field === '' ? name : `${name}.${finding.field}`,
      reason: finding.reason,
    };
  }
  return undefined;
}

/**
 * Judges a style group's `showName` (a frame's): absent or a boolean. Absent is the
 * default the reader resolves (`isFrameNameShown`); anything else would reach the renderer.
 *
 * @param style - The style value.
 * @param match - The comparison with the stored value.
 * @returns The finding, or undefined.
 */
function showNameFinding(
  style: Readonly<Record<string, unknown>>,
  match: StoredValueMatch,
): DrawableValueFinding | undefined {
  const { showName } = style;
  if (showName === undefined || typeof showName === 'boolean') return undefined;
  return refuse(match, ['showName'], showName, 'not-a-boolean');
}

/**
 * Judges a style group's `colorMode` (a frame's, main's or instance's): absent,
 * `'light'` or `'dark'`.
 *
 * @param style - The style value.
 * @param match - The comparison with the stored value.
 * @returns The finding, or undefined.
 */
function colorModeFinding(
  style: Readonly<Record<string, unknown>>,
  match: StoredValueMatch,
): DrawableValueFinding | undefined {
  const { colorMode } = style;
  if (colorMode === undefined || colorMode === 'light' || colorMode === 'dark') return undefined;
  return refuse(match, ['colorMode'], colorMode, 'out-of-range');
}

/**
 * Judges a style group's stroke style: `strokeDash`, `strokeJoin`, `strokeMiterLimit`
 * and `strokeCap`, each when present, by `strokeStyleReason`. A field written as the board holds
 * it is not judged.
 *
 * @param style - The style value.
 * @param match - The comparison with the stored value.
 * @returns The finding, or undefined.
 */
function strokeStyleFinding(
  style: Readonly<Record<string, unknown>>,
  match: StoredValueMatch,
): DrawableValueFinding | undefined {
  const finding = strokeStyleReason(style);
  if (finding === undefined) return undefined;
  const [name = ''] = finding.field.split('.');
  return match.isUnchanged([name], style[name]) ? undefined : finding;
}

/**
 * Judges a style group: an image's crop and natural size, a paint or stroke wherever the group
 * holds one, a frame's `showName`, a container's `colorMode`, a stroke style and an opacity
 * (in [0, 1] when present). A crop whose four fields are numbers is judged whole (`cropReason`: its edges
 * within the image too); otherwise each field on its own.
 *
 * @param style - The style value.
 * @param match - The comparison with the stored value.
 * @returns The first finding, or undefined.
 */
function styleFinding(style: unknown, match: StoredValueMatch): DrawableValueFinding | undefined {
  if (!isRecord(style)) return refuse(match, [], style, 'not-a-record');
  const { crop } = style;
  const isWhole = isRecord(crop) && CROP.every(([name]) => typeof crop[name] === 'number');
  const cropFinding = isWhole
    ? wholeCropFinding(crop as unknown as Crop, match)
    : judgeRecord(crop, ['crop'], CROP, match, false);
  return (
    cropFinding ??
    judgeRecord(style.naturalSize, ['naturalSize'], NATURAL_SIZE, match, false) ??
    paintedFinding(style, match) ??
    showNameFinding(style, match) ??
    colorModeFinding(style, match) ??
    strokeStyleFinding(style, match) ??
    judgeRecord(style, [], OPACITY, match)
  );
}

/**
 * Judges a crop whose four fields are numbers, as one rectangle.
 *
 * @param crop - The crop.
 * @param match - The comparison with the stored value.
 * @returns The finding, or undefined.
 */
function wholeCropFinding(crop: Crop, match: StoredValueMatch): DrawableValueFinding | undefined {
  const reason = cropReason(crop);
  return reason === undefined ? undefined : refuse(match, ['crop'], crop, reason);
}

/**
 * Judges a placement: its numbers, and its `pageId` when present (absent, `null`,
 * or a string matching the id pattern). Whether the page is live is not judged: a
 * reference, repaired by the store as `parentId` is.
 *
 * @param placement - The value.
 * @param match - The comparison with the stored value.
 * @returns The first finding, or undefined.
 */
function placementFinding(
  placement: unknown,
  match: StoredValueMatch,
): DrawableValueFinding | undefined {
  const finding = judgeRecord(placement, [], PLACEMENT, match);
  if (finding !== undefined || !isRecord(placement)) return finding;
  const { pageId } = placement;
  if (pageId === undefined || pageId === null || isPageIdText(pageId)) return undefined;
  return refuse(match, ['pageId'], pageId, 'not-an-id');
}

/**
 * Judges a pair of points stored whole.
 *
 * @param points - The value.
 * @param match - The comparison with the stored value.
 * @returns The first finding, or undefined.
 */
function pairFinding(points: unknown, match: StoredValueMatch): DrawableValueFinding | undefined {
  if (!Array.isArray(points) || points.length !== 2) {
    return refuse(match, [], points, 'not-a-record');
  }
  const [start, end] = points as readonly unknown[];
  return judgeRecord(start, ['0'], POINT, match) ?? judgeRecord(end, ['1'], POINT, match);
}

/**
 * Judges a path's segment: a record, and its handle offsets.
 *
 * @param segment - The segment.
 * @param match - The comparison with the stored value.
 * @returns The first finding, or undefined.
 */
function segmentFinding(
  segment: unknown,
  match: StoredValueMatch,
): DrawableValueFinding | undefined {
  if (!isRecord(segment)) return refuse(match, [], segment, 'not-a-record');
  return (
    judgeRecord(segment.ha, ['ha'], POINT, match, false) ??
    judgeRecord(segment.hb, ['hb'], POINT, match, false)
  );
}

/**
 * Judges the numbers one stored value carries by the ranges a renderer draws within (
 * part 1), as the relay's door check reads an incoming update: a placement's coordinates finite
 * and its rotation within float32's range; a width or height from 0 to `MAX_DRAWABLE_SIZE`
 * (2^32); a crop in the unit square with its edges within the image and a size in (0, 1]; a
 * natural size a whole number from 1 to 2^32; a fill, background or stroke as `paintReason` and
 * `strokeValueReason` judge it, a stroke style as `strokeStyleReason` does,
 * a drop shadow as `shadowValueReason` does, a stroke alignment as
 * `strokeAlignValueReason` does; a line end, a path's vertex and a segment's handle
 * offsets finite. NaN and the infinities are always refused. A judged field that is present must
 * be a number (`not-a-number`), and the value and its judged groups plain records
 * (`not-a-record`; a crop, a natural size or a handle may be absent). A field the write leaves
 * as the board already holds it is not judged: given `stored`, the door judges only what the
 * write changes (a value past its limit may stay). Pure; O(the value's fields).
 *
 * Not judged here, because they need more than one stored value: a coordinate's place on the
 * board (the parents' frames, against ±`DRAWABLE_EXTENT`), and the whole image behind a crop (the
 * box, stored apart from the crop). The engine's reader judges those (`undrawableReasonOf` in
 * `@canvas/engine`).
 *
 * @param kind - What the value holds.
 * @param value - The value as written, from any peer; not mutated.
 * @param stored - Reads the value the board holds at the same place, called at most once and
 *   only when a field would be refused; none when nothing is stored.
 * @returns The first refused field, or undefined when every judged field is acceptable.
 */
export function drawableValuesReason(
  kind: DrawableValueKind,
  value: unknown,
  stored?: StoredValueReader,
): DrawableValueFinding | undefined {
  const match = new StoredValueMatch(stored);
  switch (kind) {
    case 'placement':
      return placementFinding(value, match);
    case 'size':
      return judgeRecord(value, [], SIZE, match);
    case 'style':
      return styleFinding(value, match);
    case 'point':
    case 'vertex':
      return judgeRecord(value, [], POINT, match);
    case 'points':
      return pairFinding(value, match);
    case 'segment':
      return segmentFinding(value, match);
    case 'stroke-points':
      return numbersFinding(value, coordinateReason, match);
    case 'stroke-pressures':
      return numbersFinding(value, unitReason, match);
  }
}
