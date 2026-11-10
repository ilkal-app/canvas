import {
  INK,
  type BoardObject,
  type InkableColor,
  type InkTheme,
  type Point,
  type Rgba,
  type TokenTable,
} from '@canvas/schema';

import { colorsUnderPoint, type AverageColorOf } from './under-point.js';

// The colour a new stroke or text takes: `ink` on an empty canvas,
// where it reads well in every viewer's theme; over an object, a fixed colour that contrasts
// with what is under the point where the creation starts, since the object's colour does not
// change with the theme. A colour the person picked always wins. Pure.

/** The least WCAG contrast a chosen colour keeps with what is under it. */
export const DEFAULT_INK_CONTRAST = 4.5;

/**
 * The fixed palette, in the order it is tried: `#1f1f1f`, white, black. Black passes against any
 * colour the other two fail, so a colour is always found.
 */
export const DEFAULT_INK_PALETTE: readonly Rgba[] = Object.freeze([
  [31 / 255, 31 / 255, 31 / 255, 1],
  [1, 1, 1, 1],
  [0, 0, 0, 1],
]);

/** Each theme's canvas colour, what a translucent stack is composited over last. */
export const DEFAULT_CANVAS_COLORS: Readonly<Record<InkTheme, Rgba>> = Object.freeze({
  light: [0xf3 / 255, 0xf2 / 255, 0xef / 255, 1],
  dark: [0x1e / 255, 0x1f / 255, 0x22 / 255, 1],
});

/** What {@link chooseDefaultInk} decides from. */
export interface DefaultInkInput {
  /** Where the creation starts (the press, the click, a line's or path's first point), world units. */
  readonly point: Point;
  /** The current page's objects. */
  readonly objects: readonly BoardObject[];
  /** The creator's theme, whose canvas a translucent stack is composited over. */
  readonly theme: InkTheme;
  /** A colour the person picked (the tool's style, their last explicit choice): used as is. */
  readonly explicitColor?: InkableColor;
  /** An image asset's average colour, or null while it is pending. */
  readonly averageColorOf?: AverageColorOf;
  /** The theme's canvas colour; {@link DEFAULT_CANVAS_COLORS} by default. */
  readonly canvasColor?: Rgba;
  /** The board's colour token table, which token fills under the point resolve with. */
  readonly tokens?: TokenTable;
}

/**
 * Composites a straight-alpha colour over an opaque one.
 *
 * @param top - The colour above.
 * @param below - The opaque colour below.
 * @returns The opaque result.
 */
function over(top: Rgba, below: Rgba): Rgba {
  const alpha = top[3];
  const channel = (index: 0 | 1 | 2) => top[index] * alpha + below[index] * (1 - alpha);
  return [channel(0), channel(1), channel(2), 1];
}

/**
 * A colour's WCAG relative luminance.
 *
 * @param color - The colour, sRGB.
 * @returns Its luminance, 0 to 1.
 */
function luminance(color: Rgba): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

/**
 * The WCAG contrast ratio of two opaque colours.
 *
 * @param first - One colour.
 * @param second - The other.
 * @returns The ratio, 1 to 21.
 */
export function contrastRatio(first: Rgba, second: Rgba): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Chooses the stroke or text colour of a new shape, line, connector, pen path or text object:
 * the person's colour when they picked one; `ink` when nothing filled lies
 * under the point (or an image whose average colour is pending); else the first colour of
 * {@link DEFAULT_INK_PALETTE} with at least 4.5:1 contrast against the colour under the point,
 * translucent fills composited over what is below them and finally over the creator's canvas.
 * `ink` is never chosen over an object. Pure.
 *
 * @param input - The point, the objects, the theme and any picked colour.
 * @returns The colour to store.
 */
export function chooseDefaultInk(input: DefaultInkInput): InkableColor {
  if (input.explicitColor !== undefined) return input.explicitColor;
  const colors = { theme: input.theme, ...(input.tokens && { tokens: input.tokens }) };
  const under = colorsUnderPoint(input.objects, input.point, input.averageColorOf, colors);
  if (under.length === 0 || under.some((entry) => entry.kind === 'pending')) return INK;
  let color = input.canvasColor ?? DEFAULT_CANVAS_COLORS[input.theme];
  for (let index = under.length - 1; index >= 0; index -= 1) {
    const entry = under[index];
    if (entry?.kind === 'color') color = over(entry.color, color);
  }
  const background = color;
  const chosen = DEFAULT_INK_PALETTE.find(
    (candidate) => contrastRatio(candidate, background) >= DEFAULT_INK_CONTRAST,
  );
  return chosen === undefined ? [0, 0, 0, 1] : [...chosen];
}
