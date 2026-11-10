import { effectiveColorMode, type BoardObject, type ColorMode } from '@canvas/schema';

import { ColorPalette, type ColorTokenValues } from '../paint/color-palette.js';
import type { SceneSource } from '../scene/scene-source.js';

/** What picking reads to resolve colour tokens as the renderer draws them. */
export interface HitColors {
  /** The board's token values now. */
  readonly tokens: () => ColorTokenValues;
  /** The viewer's theme now. */
  readonly theme: () => ColorMode;
}

/**
 * The palette each object's tokens resolve in for picking: the board's token
 * values in the object's effective mode (`effectiveColorMode` over the source, else the viewer's
 * theme), so a token fill transparent in that mode is picked as the renderer draws it, as no fill.
 * Palettes are rebuilt only when the table or theme changes. Pure apart from that memo.
 *
 * @param source - The document picking reads, virtual instance content included.
 * @param colors - The board's token values and the viewer's theme.
 * @returns The palette of an object.
 */
export function hitPaletteOf(
  source: SceneSource,
  colors: HitColors,
): (object: BoardObject) => ColorPalette {
  const board = { objects: source };
  let table: ColorTokenValues | undefined;
  let palettes: Readonly<Record<ColorMode, ColorPalette>> | undefined;
  return (object) => {
    const tokens = colors.tokens();
    if (palettes === undefined || tokens !== table) {
      table = tokens;
      palettes = {
        light: new ColorPalette('light', tokens),
        dark: new ColorPalette('dark', tokens),
      };
    }
    return palettes[effectiveColorMode(object, board, colors.theme())];
  };
}
