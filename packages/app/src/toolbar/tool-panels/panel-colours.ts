import { isInk, isTokenRef, type InkableColor, type Rgba } from '@canvas/schema';
import { NOTE_COLORS } from '@canvas/tools';

import type { ColourChoice, ColourGroup } from '../../controls/colour-button.js';

// The colours a tool panel's colour buttons offer and how a panel's colour reads as the
// ColourButton's string value: `ink` (the stroke and line default, drawn in the
// theme's ink), `none`, a board token as `token:<id>`, or a fixed colour as `#rrggbb`.

/** The value for no colour (a shape without a fill or an outline). */
export const NO_COLOUR = 'none';

/**
 * A channel in [0, 1] as two hex digits.
 *
 * @param channel - The channel.
 * @returns Its hex.
 */
function hexOf(channel: number): string {
  return Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * A fixed colour as `#rrggbb` (its alpha is left out: the panels offer opaque colours). Pure.
 *
 * @param color - The colour.
 * @returns Its hex.
 */
export function hexOfRgba(color: Readonly<Rgba>): string {
  const [r, g, b] = color;
  return `#${hexOf(r)}${hexOf(g)}${hexOf(b)}`;
}

/**
 * A `#rrggbb` as an opaque colour, or `undefined` for anything else. Pure.
 *
 * @param hex - The text.
 * @returns The colour.
 */
export function rgbaOfHex(hex: string): Rgba | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) return undefined;
  const [, r = '0', g = '0', b = '0'] = match;
  return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255, 1];
}

/**
 * A panel colour as the ColourButton's value. Pure.
 *
 * @param color - The colour, or `null` for none.
 * @returns The value.
 */
export function colourValueOf(color: InkableColor | null): string {
  if (color === null) return NO_COLOUR;
  if (isInk(color)) return 'ink';
  if (isTokenRef(color)) return `token:${color.token}`;
  return hexOfRgba(color);
}

/**
 * A ColourButton value as a panel colour: `undefined` for a value it cannot be (a malformed
 * custom colour). Pure.
 *
 * @param value - The value.
 * @returns The colour, `null` for none.
 */
export function colourOfValue(value: string): InkableColor | null | undefined {
  if (value === NO_COLOUR) return null;
  if (value === 'ink') return 'ink';
  if (value.startsWith('token:')) return { token: value.slice('token:'.length) };
  return rgbaOfHex(value);
}

/**
 * What a panel colour is called on its button.
 *
 * @param color - The colour, or `null`.
 * @returns Its name.
 */
export function colourLabelOf(color: InkableColor | null): string {
  if (color === null) return 'None';
  if (isInk(color)) return 'Ink';
  if (isTokenRef(color)) return 'Board colour';
  const hex = hexOfRgba(color);
  return NOTE_COLORS.find(({ color: note }) => hexOfRgba(note) === hex)?.name ?? hex;
}

/**
 * A panel colour's swatch, as CSS.
 *
 * @param color - The colour, or `null`.
 * @returns The fill.
 */
export function colourSwatchOf(color: InkableColor | null): string {
  if (color === null) return 'transparent';
  if (isInk(color)) return 'var(--color-ink-primary)';
  if (isTokenRef(color)) return 'var(--color-line-strong)';
  return hexOfRgba(color);
}

/** The palette's fixed colours: the sticky colours, then white, grey and black. */
const FIXED_CHOICES: readonly ColourChoice[] = [
  ...NOTE_COLORS.map(({ name, color }) => ({
    value: hexOfRgba(color),
    label: name,
    swatch: hexOfRgba(color),
  })),
  { value: '#ffffff', label: 'White', swatch: '#ffffff' },
  { value: '#8c8a83', label: 'Grey', swatch: '#8c8a83' },
  { value: '#1e1f1c', label: 'Black', swatch: '#1e1f1c' },
];

/**
 * A panel colour button's palette: Ink (where the colour may be ink), None (where it may be
 * none), then the fixed colours; a custom hex is typed in the button's own field.
 *
 * @param options - Which of Ink and None the colour may be.
 * @param options.canBeInk - Whether it may be ink.
 * @param options.canBeNone - Whether it may be none.
 * @returns The palette's groups.
 */
export function panelPaletteOf(options: {
  readonly canBeInk: boolean;
  readonly canBeNone: boolean;
}): readonly ColourGroup[] {
  const special: ColourChoice[] = [
    ...(options.canBeInk
      ? [{ value: 'ink', label: 'Ink', swatch: 'var(--color-ink-primary)' }]
      : []),
    ...(options.canBeNone ? [{ value: NO_COLOUR, label: 'None', swatch: 'transparent' }] : []),
  ];
  return [
    { label: 'Default', choices: special },
    { label: 'Colours', choices: FIXED_CHOICES },
  ];
}
