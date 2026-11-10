import {
  isSameColor,
  isSameFontFeatures,
  isSameFontVariations,
  type FontVariations,
  type StickyObject,
  type TextObject,
} from '@canvas/schema';
import { autoDirectionOf } from '@canvas/text';
import {
  toggledItalic,
  toggledStrikethrough,
  toggledUnderline,
  toggledWeight,
  type TextStylePatch,
} from '@canvas/tools';

import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';
import { weightPatchOf } from '../text-input/curated-variable.js';

import type { TextStyleChange, TextStyleContext } from './text-style-types.js';

/**
 * Whether two style contexts show the same thing: the same fields, alignment and editing state.
 *
 * @param first - A context, or undefined.
 * @param second - Another.
 * @returns True when every field matches (colours channel by channel, spacing value by value).
 */
export function isSameStyleContext(
  first: TextStyleContext | undefined,
  second: TextStyleContext | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  if (first.align !== second.align || first.isEditing !== second.isEditing) return false;
  if (first.list !== second.list) return false;
  if (first.canAlign !== second.canAlign || first.canDirect !== second.canDirect) return false;
  if (first.canSetLanguage !== second.canSetLanguage) return false;
  if (first.canSetFeatures !== second.canSetFeatures) return false;
  if (first.direction !== second.direction || first.autoDirection !== second.autoDirection)
    return false;
  if (first.edited?.id !== second.edited?.id || first.edited?.type !== second.edited?.type)
    return false;
  const [a, b] = [first.style, second.style];
  const isSameColour =
    a.color === b.color ||
    (a.color !== undefined && b.color !== undefined && isSameColor(a.color, b.color));
  return (
    isSameColour &&
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.weight === b.weight &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    'lang' in a === 'lang' in b &&
    a.lang === b.lang &&
    // A face shared, none (spelt out) or mixed (absent).
    'postScriptName' in a === 'postScriptName' in b &&
    a.postScriptName === b.postScriptName &&
    // Feature settings shared (in any order), none or mixed (absent).
    'fontFeatures' in a === 'fontFeatures' in b &&
    isSameFontFeatures(a.fontFeatures ?? undefined, b.fontFeatures ?? undefined) &&
    // A link shared, none (spelt out) or mixed (absent).
    'link' in a === 'link' in b &&
    a.link === b.link &&
    isSameShownField(a.letterSpacing, b.letterSpacing) &&
    isSameShownField(a.lineHeight, b.lineHeight) &&
    isSameShownCoordinates(a.fontVariations, b.fontVariations) &&
    isSameAxisValues(first.axisValues, second.axisValues)
  );
}

/**
 * Whether two contexts' per-axis values are the same: both absent, or the same tags
 * with the same values ({@link MIXED} included).
 *
 * @param first - One context's values.
 * @param second - The other's.
 * @returns True when they match.
 */
function isSameAxisValues(
  first: TextStyleContext['axisValues'],
  second: TextStyleContext['axisValues'],
): boolean {
  if (first === undefined || second === undefined) return first === second;
  const tags = Object.keys(first);
  return (
    tags.length === Object.keys(second).length && tags.every((tag) => first[tag] === second[tag])
  );
}

/**
 * Each variable-font axis's value across some runs (`TextStyleContext.axisValues`): a
 * run's own coordinate, else for `wght` its weight (400 when unset); {@link MIXED} when runs
 * differ or some leave the tag unset; tags no run sets are left out. Pure.
 *
 * @param runs - The runs' shown styles (`runStylesOfObjects`).
 * @returns The values; undefined when no run sets a coordinate.
 */
export function axisValuesOf(
  runs: readonly TextStylePatch[],
): Record<string, Mixable<number>> | undefined {
  const tags = new Set(runs.flatMap(({ fontVariations }) => Object.keys(fontVariations ?? {})));
  if (tags.size === 0) return undefined;
  const valueOf = (run: TextStylePatch, tag: string): number | undefined =>
    run.fontVariations?.[tag] ?? (tag === 'wght' ? (run.weight ?? 400) : undefined);
  return Object.fromEntries(
    [...tags].map((tag) => {
      const values = new Set(runs.map((run) => valueOf(run, tag)));
      const [value] = values;
      return [tag, values.size === 1 && value !== undefined ? value : MIXED];
    }),
  );
}

/**
 * Whether two shown values of a spacing field are the same: both mixed (absent), or
 * both present and equal value by value. None is spelt out (`shownTextStyle`), so it differs
 * from mixed.
 *
 * @param first - One value, or undefined when mixed.
 * @param second - The other.
 * @returns True when they show the same.
 */
function isSameShownField(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/**
 * The style fields a change sets, the toggles resolved against the current style.
 *
 * @param change - The change.
 * @param current - The shared fields now.
 * @returns The fields to set.
 */
export function patchOf(change: TextStyleChange, current: TextStylePatch): TextStylePatch {
  switch (change.kind) {
    case 'style':
      return change.patch;
    case 'toggleBold':
      return weightPatchOf(toggledWeight(current), current.fontFamily);
    case 'toggleItalic':
      return { italic: toggledItalic(current) };
    case 'toggleUnderline':
      return { underline: toggledUnderline(current) };
    case 'toggleStrikethrough':
      return { strikethrough: toggledStrikethrough(current) };
    case 'list':
    case 'listLevel':
    case 'align':
    case 'direction':
    case 'preview':
    case 'endPreview':
      return {};
  }
}

/**
 * The direction fields of the context for text objects and notes: the direction they
 * share (absent read as auto), {@link MIXED} when they differ, and the direction their auto ones'
 * first paragraphs take: `rtl` when every one's is right to left, {@link MIXED} when some are and
 * some are not, and absent (left to right) otherwise.
 *
 * @param texts - The targeted text objects and notes.
 * @returns The fields.
 */
export function directionContextOf(
  texts: readonly (TextObject | StickyObject)[],
): Pick<TextStyleContext, 'direction' | 'autoDirection'> {
  const directions = new Set(texts.map((object) => object.direction ?? 'auto'));
  const [shared] = directions;
  const direction = directions.size === 1 && shared !== undefined ? shared : MIXED;
  const autos = new Set(
    texts
      .filter((object) => (object.direction ?? 'auto') === 'auto')
      .map((object) => autoDirectionOf(object.text)),
  );
  if (!autos.has('rtl')) return { direction };
  return { direction, autoDirection: autos.size === 1 ? 'rtl' : MIXED };
}

/**
 * Whether two shown variable-font coordinates are the same: both mixed (absent), or
 * both present and equal tag by tag in any order. None is spelt out as `{}` (`shownTextStyle`),
 * so it differs from mixed.
 *
 * @param first - One value, or undefined for mixed.
 * @param second - The other.
 * @returns True when they are the same.
 */
function isSameShownCoordinates(
  first: FontVariations | undefined,
  second: FontVariations | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return isSameFontVariations(first, second);
}
