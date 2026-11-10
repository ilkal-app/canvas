import { inkColorsOfThemes } from '../../theme/canvas-background.js';

import { rgbaToHex } from './colour-hex.js';

/**
 * The CSS background of an Ink swatch: half the light theme's ink, half the dark theme's, from
 * the themes' `ink/primary` tokens (`inkColorsOfThemes`), whatever the panel's own theme. Set
 * inline, since a stylesheet references only the current theme's tokens.
 *
 * @returns The background.
 */
export function inkSwatchBackground(): string {
  const { light, dark } = inkColorsOfThemes();
  return `linear-gradient(to bottom right, ${rgbaToHex(light)} 0 50%, ${rgbaToHex(dark)} 50% 100%)`;
}

/**
 * What a colour picker holds while its value is `ink`.
 *
 * @returns The light theme's ink, as hex.
 */
export function inkPickerHex(): string {
  return rgbaToHex(inkColorsOfThemes().light);
}
