import { isCharacterBoundary } from '../fields/character-boundary.js';
import type { TextContent } from '../fields/text-content.js';
import {
  isSameTextStyle,
  restyledFace,
  withPostScriptName,
  type StyleRun,
  type TextStyle,
} from '../fields/text-style.js';
import type { BoardObject } from '../objects/board-object.js';

import type { OverrideRecord, TextStyleOverride } from './instance-overrides.js';

/**
 * The override vocabulary accepted for every child that draws, independent of its type:
 * visibility and its layer opacity.
 */
const LAYER_FIELDS = ['isHidden', 'opacity'] as const;

/** The override vocabulary of a child without a layer opacity (a comment or a video). */
const HIDDEN_ONLY_FIELDS = ['isHidden'] as const;

/** A box child's geometry as a variant's preset sets it. */
const BOX_FIELDS = ['x', 'y', 'width', 'height'] as const;

/** The text vocabulary of every type that takes text: characters, their runs, a style over all. */
const TEXT_FIELDS = ['text', 'textStyle', 'runs'] as const;

/**
 * Lists the properties this source type can override, without exposing structure. A type that
 * takes `text` also takes `textStyle` and `runs`.
 *
 * @param object - The real source child.
 * @returns The allowed override record keys, including visibility.
 */
export function instanceOverrideFields(object: BoardObject): readonly (keyof OverrideRecord)[] {
  switch (object.type) {
    case 'text':
      // A text's height comes from its content.
      return [...LAYER_FIELDS, ...TEXT_FIELDS, 'measuredSize', 'x', 'y', 'width'];
    case 'sticky':
      return [...LAYER_FIELDS, ...TEXT_FIELDS, 'color', 'measuredSize', ...BOX_FIELDS];
    case 'shape':
      return [...LAYER_FIELDS, ...TEXT_FIELDS, 'fill', 'strokeColor', ...BOX_FIELDS];
    case 'connector':
      return [...LAYER_FIELDS, ...TEXT_FIELDS, 'strokeColor'];
    case 'path':
      // A path's shape comes from its vertices; only its place moves.
      return [...LAYER_FIELDS, 'fill', 'strokeColor', 'x', 'y'];
    case 'freehand':
      // A stroke's shape comes from its points; only its place moves.
      return [...LAYER_FIELDS, 'strokeColor', 'x', 'y'];
    case 'line':
      return [...LAYER_FIELDS, 'strokeColor'];
    case 'image':
      return [...LAYER_FIELDS, 'assetId', 'naturalSize', 'crop', ...BOX_FIELDS];
    case 'instance':
      return [...LAYER_FIELDS, 'variant', 'mainId', ...BOX_FIELDS];
    case 'frame':
      // Its paint: `fill` is its background, `strokeColor` its stroke's colour.
      return [...LAYER_FIELDS, 'fill', 'strokeColor', ...BOX_FIELDS, 'autoLayout'];
    case 'group':
      // A group's bounds come from its children; only its place moves.
      return [...LAYER_FIELDS, 'x', 'y'];
    default:
      return HIDDEN_ONLY_FIELDS;
  }
}

/** Record fields the override rows don't offer: derived, or set through their own controls. */
const NOT_ROW_FIELDS: ReadonlySet<keyof OverrideRecord> = new Set([
  'measuredSize',
  'variant',
  'mainId',
  // A preset's geometry and layout, which the inspector does not edit yet.
  ...BOX_FIELDS,
  'autoLayout',
]);

/**
 * The override fields a person or agent sets on this source type as an override row:
 * {@link instanceOverrideFields} without the ones its writer derives (`measuredSize`,
 * measured when text is overridden) and a nested instance's `variant` and `mainId`, which the
 * variant and swap controls set, so what the inspector and the board projection offer as rows stays what one can
 * choose there.
 *
 * @param object - The real source child.
 * @returns The allowed override record keys one chooses, including visibility.
 */
export function editableOverrideFields(object: BoardObject): readonly (keyof OverrideRecord)[] {
  return instanceOverrideFields(object).filter((field) => !NOT_ROW_FIELDS.has(field));
}

/**
 * Applies replacement characters in the main's current styles. Source run boundaries are
 * clipped, moved forward out of surrogate pairs, and the last style covers added characters.
 *
 * @param source - The source text or label and its current runs.
 * @param text - The replacement characters.
 * @returns A valid text value in inherited styles; the source is not changed.
 */
function inheritText(source: TextContent, text: string): TextContent {
  const first = source.runs[0];
  if (first === undefined) return source;
  if (text.length === 0) return { text, runs: [{ length: 0, style: first.style }] };
  const runs: StyleRun[] = [];
  let sourceEnd = 0;
  let end = 0;
  source.runs.forEach((run, index) => {
    sourceEnd += run.length;
    let next = index === source.runs.length - 1 ? text.length : Math.min(sourceEnd, text.length);
    if (!isCharacterBoundary(text, next)) next += 1;
    const length = Math.max(0, next - end);
    if (length === 0) return;
    const previous = runs.at(-1);
    if (previous !== undefined && isSameTextStyle(previous.style, run.style)) {
      runs[runs.length - 1] = { length: previous.length + length, style: previous.style };
    } else runs.push({ length, style: run.style });
    end = next;
  });
  return { text, runs };
}

/**
 * Lays a partial style over every run, merging neighbours the new styles make equal, so the
 * result still satisfies the stored-text run rules.
 *
 * @param content - Valid text and runs.
 * @param style - The fields to set on every run.
 * @returns New text content; the input is not changed.
 */
function restyleText(content: TextContent, style: TextStyleOverride): TextContent {
  const fields = Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  ) as Partial<TextStyle>;
  const runs: StyleRun[] = [];
  for (const run of content.runs) {
    // A face belongs to its family: a family-only override drops the source's face.
    const restyled = withPostScriptName(
      { ...run.style, ...fields },
      restyledFace(run.style, fields),
    );
    const previous = runs.at(-1);
    if (previous !== undefined && isSameTextStyle(previous.style, restyled)) {
      runs[runs.length - 1] = { length: previous.length + run.length, style: previous.style };
    } else runs.push({ length: run.length, style: restyled });
  }
  return { text: content.text, runs };
}

/**
 * Overrides a child's text: the record's own `runs` beside its `text`, else its `text` in the
 * source's styles, else the source text; then its `textStyle` over every run.
 *
 * @param source - The source text or label.
 * @param override - A validated record.
 * @returns The resolved text content; the source is not changed.
 */
function overrideText(source: TextContent, override: OverrideRecord): TextContent {
  let content = source;
  if (override.text !== undefined) {
    content =
      override.runs === undefined
        ? inheritText(source, override.text)
        : { text: override.text, runs: override.runs };
  }
  return override.textStyle === undefined ? content : restyleText(content, override.textStyle);
}

/**
 * Applies only type-appropriate content, text style, colour and opacity overrides. Geometry, stroke
 * widths and unsupported fields continue to come from the main. Visibility is handled by the tree
 * resolver so hiding a container also hides its descendants.
 *
 * @param object - The source child, already mapped into the instance's size.
 * @param override - A validated property record.
 * @returns The overridden child without mutating either input.
 */
export function applyInstanceOverride(object: BoardObject, override: OverrideRecord): BoardObject {
  let result = object;
  if (override.text !== undefined || override.textStyle !== undefined) {
    if (result.type === 'text' || result.type === 'sticky') {
      result = { ...result, ...overrideText(result, override) };
    } else if ((result.type === 'shape' || result.type === 'connector') && result.label !== null) {
      result = { ...result, label: overrideText(result.label, override) };
    }
  }
  if (override.fill !== undefined && (result.type === 'shape' || result.type === 'path')) {
    result = { ...result, fill: override.fill };
  }
  // A frame's fill is its background.
  if (override.fill !== undefined && result.type === 'frame') {
    result = { ...result, background: override.fill };
  }
  if (
    override.strokeColor !== undefined &&
    'stroke' in result &&
    result.stroke !== null &&
    result.stroke !== undefined
  ) {
    result = { ...result, stroke: { ...result.stroke, color: override.strokeColor } };
  }
  if (override.color !== undefined && result.type === 'sticky') {
    result = { ...result, color: override.color };
  }
  if (result.type === 'image') {
    result = {
      ...result,
      ...(override.assetId === undefined ? {} : { assetId: override.assetId }),
      ...(override.naturalSize === undefined ? {} : { naturalSize: override.naturalSize }),
      ...(override.crop === undefined ? {} : { crop: override.crop }),
    };
  }
  // A layer opacity, on every type that stores one; an image's replaces its own.
  if (override.opacity !== undefined && result.type !== 'comment' && result.type !== 'video') {
    result = { ...result, opacity: override.opacity };
  }
  // A nested instance's selection: the record's axes win, the rest stay its own.
  if (override.variant !== undefined && result.type === 'instance') {
    result = { ...result, variant: { ...result.variant, ...override.variant } };
  }
  return result;
}
