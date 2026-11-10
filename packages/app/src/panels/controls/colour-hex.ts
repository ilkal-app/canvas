import type { Rgba } from '@canvas/schema';

/**
 * A colour as `#rrggbb`, the form a colour input holds; alpha is dropped. The prototype's
 * `rgbaToHex` (webgl-whiteboard `src/app/color.ts`).
 *
 * @param colour - The colour, channels in [0, 1] (clamped).
 * @returns Lower-case `#rrggbb`.
 */
export function rgbaToHex(colour: Rgba): string {
  const byte = (channel: number) =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(colour[0])}${byte(colour[1])}${byte(colour[2])}`;
}

/**
 * A `#rrggbb` colour as channels in [0, 1], with the alpha given.
 *
 * @param hex - `#rrggbb`, as a colour input reports it.
 * @param alpha - The alpha to keep, in [0, 1].
 * @returns The colour, or undefined when `hex` is not six hex digits after `#`.
 */
export function hexToRgba(hex: string, alpha: number): Rgba | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
}

/**
 * A colour as a CSS colour with its alpha, for a swatch: `rgb(r g b / a)`.
 *
 * @param colour - The colour, straight alpha, channels in [0, 1].
 * @returns The CSS `rgb()` value.
 */
export function rgbaToCss(colour: Readonly<Rgba>): string {
  const [red, green, blue, alpha] = colour.map((channel, index) =>
    index < 3 ? Math.round(channel * 255) : channel,
  );
  return `rgb(${String(red)} ${String(green)} ${String(blue)} / ${String(alpha)})`;
}

/**
 * A swatch's CSS background: the colour over a light and dark checkerboard, so a
 * translucent colour shows as translucent; an opaque one covers the board.
 *
 * @param colour - The colour, straight alpha, channels in [0, 1].
 * @returns The CSS `background` value.
 */
export function swatchBackground(colour: Readonly<Rgba>): string {
  const css = rgbaToCss(colour);
  return `linear-gradient(${css}, ${css}), repeating-conic-gradient(var(--color-surface-sheet) 0 25%, var(--color-line-control) 0 50%) 0 0 / 8px 8px`;
}
