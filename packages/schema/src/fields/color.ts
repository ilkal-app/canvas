import { z } from 'zod';

import { tokenRefSchema, type TokenRef } from './token-ref.js';

/** One colour channel: a number in [0, 1]. */
const channelSchema = z.number().min(0).max(1);

/**
 * Validates a colour: `[red, green, blue, alpha]`, each channel a number in [0, 1], straight
 * (not premultiplied) alpha, sRGB. The prototype's `RGBA` (`src/text/style.ts`).
 */
export const rgbaSchema = z
  .tuple([channelSchema, channelSchema, channelSchema, channelSchema])
  .describe('Colour as [red, green, blue, alpha], each in 0..1, sRGB, straight alpha.');

/** A colour: `[red, green, blue, alpha]`, each channel in [0, 1]. */
export type Rgba = z.output<typeof rgbaSchema>;

/**
 * The theme-aware colour token: stored beside a colour tuple, drawn
 * dark grey on the light theme's canvas and light grey on the dark theme's, for every viewer in
 * their own theme ({@link INK_COLORS}).
 */
export const INK = 'ink';

/**
 * Validates a colour that may name a board colour token: a tuple or a
 * token reference `{ token }`. A fill, a frame's background (the solid branch of a paint), a
 * sticky's colour and an override's `fill`, `strokeColor` and `color` take it; never the
 * literal `'ink'` (a fill may name the ink token as `{ token: 'ink' }`).
 */
export const colorSchema = z
  .union([rgbaSchema, tokenRefSchema], {
    error: 'Invalid input: expected a colour [r, g, b, a] or a token { token }',
  })
  .describe(
    'Colour as [red, green, blue, alpha] in 0..1, or a board colour token { token: id } drawn in its light or dark value.',
  );

/** A colour tuple or a token reference. */
export type Color = Rgba | TokenRef;

/**
 * Validates a colour that may also be {@link INK} or a token reference: a stroke's colour or a
 * text style's. Gradient stops never take either.
 */
export const inkableColorSchema = z
  .union([rgbaSchema, z.literal(INK), tokenRefSchema], {
    error: "Invalid input: expected a colour [r, g, b, a], 'ink' or a token { token }",
  })
  .describe(
    "Colour as [red, green, blue, alpha] in 0..1, 'ink' (dark grey on a light canvas, light grey on a dark one; on a filled frame, light on a dark fill and dark on a light one), or a board colour token { token: id }.",
  );

/** A colour tuple, the {@link INK} token or a token reference. */
export type InkableColor = Rgba | typeof INK | TokenRef;

/** A viewer's theme, which resolves {@link INK}. */
export type InkTheme = 'light' | 'dark';

/**
 * What {@link INK} draws as in each theme: the shell's `ink/primary` theme token, Vellum
 * `#1E1F1C` on the light canvas and Graphite `#ECEBE5` on the dark one, opaque (
 * takes ink from the theme tokens). The schema cannot read the app's tokens, so these
 * defaults are kept equal to them (`inkColorsOfThemes` in `@canvas/app` is tested against them).
 * Each keeps at least 7:1 contrast with its theme's canvas.
 */
export const INK_COLORS: Readonly<Record<InkTheme, Rgba>> = Object.freeze({
  light: Object.freeze([30 / 255, 31 / 255, 28 / 255, 1]) as unknown as Rgba,
  dark: Object.freeze([236 / 255, 235 / 255, 229 / 255, 1]) as unknown as Rgba,
});

/**
 * Tells whether a stored colour is the {@link INK} token.
 *
 * @param color - A colour as stored.
 * @returns True for exactly `'ink'`.
 */
export function isInk(color: unknown): color is typeof INK {
  return color === INK;
}
