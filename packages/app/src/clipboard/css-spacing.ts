import {
  letterSpacingSchema,
  lineHeightSchema,
  type LetterSpacing,
  type LineHeight,
  type TextStyle,
} from '@canvas/schema';

// A run's letter-spacing and line-height as CSS, both ways, for the clipboard's HTML
// flavour. CSS has no percent letter-spacing, so a percent of the font size is written in `em`
// and read back as a percent; a line-height is written in px or percent, and a unitless one
// (a multiple of the font size) is read as a percent. A value the schema refuses is dropped.

/** Decimals a value read from CSS keeps. */
const DECIMALS = 1000;

/**
 * A number rounded to three decimals.
 *
 * @param value - The number.
 * @returns It, rounded.
 */
function rounded(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

/**
 * A run's letter-spacing as a CSS `letter-spacing` value.
 *
 * @param style - The run's style.
 * @returns The value, or undefined for none.
 */
export function cssLetterSpacing(style: TextStyle): string | undefined {
  const spacing = style.letterSpacing;
  if (spacing === undefined || spacing.value === 0) return undefined;
  return spacing.unit === 'px'
    ? `${String(spacing.value)}px`
    : `${String(rounded(spacing.value / 100))}em`;
}

/**
 * A run's line-height as a CSS `line-height` value.
 *
 * @param style - The run's style.
 * @returns The value, or undefined for auto.
 */
export function cssLineHeight(style: TextStyle): string | undefined {
  const height = style.lineHeight;
  if (height === undefined || height === 'auto') return undefined;
  return height.unit === 'px' ? `${String(height.value)}px` : `${String(height.value)}%`;
}

/**
 * Splits a CSS length into its number and unit.
 *
 * @param value - The declaration's value.
 * @returns The number and lower-case unit (empty for none), or undefined when not a length.
 */
function lengthOf(value: string): { readonly amount: number; readonly unit: string } | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|em|%)?$/i.exec(value.trim());
  if (match === null) return undefined;
  return { amount: Number(match[1]), unit: (match[2] ?? '').toLowerCase() };
}

/**
 * The letter-spacing a CSS `letter-spacing` declares.
 *
 * @param value - The declaration's value, or empty when there is none.
 * @returns The spacing; `null` for `normal` (none); undefined when nothing readable is declared.
 */
export function declaredLetterSpacing(value: string): LetterSpacing | null | undefined {
  if (value.trim() === 'normal') return null;
  const length = lengthOf(value);
  if (length === undefined) return undefined;
  const spacing =
    length.unit === 'px'
      ? { value: length.amount, unit: 'px' }
      : length.unit === 'em'
        ? { value: rounded(length.amount * 100), unit: 'percent' }
        : undefined;
  const parsed = letterSpacingSchema.safeParse(spacing);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The line-height a CSS `line-height` declares.
 *
 * @param value - The declaration's value, or empty when there is none.
 * @returns The line-height (`'auto'` for `normal`), or undefined when nothing readable is
 *   declared.
 */
export function declaredLineHeight(value: string): LineHeight | undefined {
  if (value.trim() === 'normal') return 'auto';
  const length = lengthOf(value);
  if (length === undefined) return undefined;
  const height =
    length.unit === 'px'
      ? { value: length.amount, unit: 'px' }
      : length.unit === '%'
        ? { value: length.amount, unit: 'percent' }
        : length.unit === ''
          ? { value: rounded(length.amount * 100), unit: 'percent' }
          : undefined;
  const parsed = lineHeightSchema.safeParse(height);
  return parsed.success ? parsed.data : undefined;
}
