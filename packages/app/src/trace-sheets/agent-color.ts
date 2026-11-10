import type { Rgba } from '@canvas/schema';

import { THEMES, type ThemeName } from '../theme/theme-tokens.js';

/**
 * The agent colour of a theme as numbers, read from its `--color-hand-agent` token
 * (#9DB4C4 in Graphite, #4E6E86 in Vellum), for the engine's trace tint; the sheet's tab uses
 * the token itself. Pure.
 *
 * @param themeName - The theme.
 * @returns The colour, straight alpha, channels 0 to 1, opaque.
 */
export function agentColorOf(themeName: ThemeName): Rgba {
  const hex = THEMES[themeName]['--color-hand-agent'];
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  return [red, green, blue, 1];
}
