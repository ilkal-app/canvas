import {
  LETTER_SPACING_LIMITS,
  MAX_LINE_HEIGHT,
  type LetterSpacing,
  type LineHeight,
} from '@canvas/schema';
import { NO_LETTER_SPACING, type TextStylePatch } from '@canvas/tools';

import { MIXED, type Mixable } from '../controls/mixed-value.js';

// The style panel's spacing fields: a number and its unit for the letter-spacing and
// for the line-height, as Figma shows them. Pure: what each field shows for the targeted text's
// shared style, and the patch a change sets.

/** A unit a spacing field may be shown in. */
export type SpacingUnit = 'px' | 'percent';

/** A line-height's unit choice: a unit, or auto. */
export type LineHeightChoice = SpacingUnit | 'auto';

/** What an auto line-height shows: 1.25 × the font size, as a percent. */
export const AUTO_LINE_HEIGHT_PERCENT = 125;

/** The decimals a converted value keeps. */
const DECIMALS = 100;

/** What a spacing field shows: its number and unit, either mixed. */
export interface ShownSpacing<Unit extends string> {
  /** The number. */
  readonly value: Mixable<number>;
  /** The unit. */
  readonly unit: Mixable<Unit>;
  /** The smallest number the field takes. */
  readonly min: number;
  /** The largest. */
  readonly max: number;
}

/**
 * A value in another unit: px and percent of the font size convert through the size, rounded to
 * two decimals; without one shared size the number is kept.
 *
 * @param value - The value.
 * @param from - Its unit.
 * @param to - The unit wanted.
 * @param fontSize - The shared font size, or undefined when mixed.
 * @returns The value in `to`.
 */
export function convertSpacing(
  value: number,
  from: SpacingUnit,
  to: SpacingUnit,
  fontSize: number | undefined,
): number {
  if (from === to || fontSize === undefined) return value;
  const converted = to === 'px' ? (value / 100) * fontSize : (value / fontSize) * 100;
  return Math.round(converted * DECIMALS) / DECIMALS;
}

/**
 * The letter-spacing field: mixed when the text disagrees, else its value and unit (none is 0 %).
 *
 * @param style - The targeted text's shared fields.
 * @returns What the field shows.
 */
export function shownLetterSpacing(style: TextStylePatch): ShownSpacing<SpacingUnit> {
  const spacing = style.letterSpacing;
  const unit = spacing?.unit ?? 'percent';
  return {
    value: spacing === undefined ? MIXED : spacing.value,
    unit: spacing === undefined ? MIXED : unit,
    ...LETTER_SPACING_LIMITS[unit],
  };
}

/**
 * The line-height field: mixed when the text disagrees, auto as 125 %, else its value and unit.
 *
 * @param style - The targeted text's shared fields.
 * @returns What the field shows.
 */
export function shownLineHeight(style: TextStylePatch): ShownSpacing<LineHeightChoice> {
  const height = style.lineHeight;
  const unit = height === undefined || height === 'auto' ? 'percent' : height.unit;
  const limits = { min: 1, max: MAX_LINE_HEIGHT[unit] };
  if (height === undefined) return { value: MIXED, unit: MIXED, ...limits };
  if (height === 'auto') return { value: AUTO_LINE_HEIGHT_PERCENT, unit: 'auto', ...limits };
  return { value: height.value, unit: height.unit, ...limits };
}

/**
 * The letter-spacing a number typed into the field sets: in the field's unit, percent when it is
 * mixed.
 *
 * @param style - The targeted text's shared fields.
 * @param value - The number.
 * @returns The patch.
 */
export function letterSpacingValuePatch(style: TextStylePatch, value: number): TextStylePatch {
  const unit = style.letterSpacing?.unit ?? 'percent';
  const letterSpacing: LetterSpacing = { value, unit };
  return { letterSpacing };
}

/**
 * The letter-spacing a unit choice sets: the shown value converted to it.
 *
 * @param style - The targeted text's shared fields.
 * @param unit - The unit chosen.
 * @returns The patch, or undefined when the spacing is mixed (there is no value to convert).
 */
export function letterSpacingUnitPatch(
  style: TextStylePatch,
  unit: SpacingUnit,
): TextStylePatch | undefined {
  const spacing = style.letterSpacing;
  if (spacing === undefined) return undefined;
  const value = convertSpacing(spacing.value, spacing.unit, unit, style.fontSize);
  const { min, max } = LETTER_SPACING_LIMITS[unit];
  const letterSpacing: LetterSpacing = { value: Math.min(max, Math.max(min, value)), unit };
  return { letterSpacing: letterSpacing.value === 0 ? NO_LETTER_SPACING : letterSpacing };
}

/**
 * The line-height a number typed into the field sets: in the field's unit, percent while it is
 * auto or mixed.
 *
 * @param style - The targeted text's shared fields.
 * @param value - The number.
 * @returns The patch.
 */
export function lineHeightValuePatch(style: TextStylePatch, value: number): TextStylePatch {
  const height = style.lineHeight;
  const unit = height === undefined || height === 'auto' ? 'percent' : height.unit;
  const lineHeight: LineHeight = { value, unit };
  return { lineHeight };
}

/**
 * The line-height a unit choice sets: auto, or the shown value (auto's 125 %) converted to the
 * unit.
 *
 * @param style - The targeted text's shared fields.
 * @param choice - Auto, or the unit chosen.
 * @returns The patch, or undefined when the line-height is mixed and a unit is chosen.
 */
export function lineHeightUnitPatch(
  style: TextStylePatch,
  choice: LineHeightChoice,
): TextStylePatch | undefined {
  if (choice === 'auto') return { lineHeight: 'auto' };
  const height = style.lineHeight;
  if (height === undefined) return undefined;
  const [value, unit] =
    height === 'auto'
      ? [AUTO_LINE_HEIGHT_PERCENT, 'percent' as const]
      : [height.value, height.unit];
  const converted = convertSpacing(value, unit, choice, style.fontSize);
  const max = MAX_LINE_HEIGHT[choice];
  return { lineHeight: { value: Math.min(max, Math.max(1, converted)), unit: choice } };
}
