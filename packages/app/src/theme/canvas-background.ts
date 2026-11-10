import type { InkTheme, Rgba } from '@canvas/schema';
import type { OverlayPalette } from '@canvas/tools';

import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';

import type { ColorTokenName } from './color-tokens.js';
import { THEMES, type ThemeName } from './theme-tokens.js';

/**
 * A theme's colour token as numbers: a `#rrggbb` value, opaque.
 *
 * @param themeName - The theme.
 * @param token - The token.
 * @returns The colour, straight alpha, channels 0 to 1.
 */
function tokenColorOf(themeName: ThemeName, token: ColorTokenName): Rgba {
  const hex = THEMES[themeName][token];
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  return [red, green, blue, 1];
}

/**
 * The canvas background of a theme, read from its `--color-ground-mat` token (Figma's
 * `ground/mat`): an off-white in Vellum and an off-black in Graphite, never pure white
 * or black. The token is the one definition: the shell and the canvas mount paint it in CSS, the
 * engine clears to transparent over it, and anything that needs the colour as numbers (a
 * renderer's clear colour, an export's backdrop) reads it here. Pure.
 *
 * @param themeName - The theme.
 * @returns The colour, straight alpha, channels 0 to 1, opaque.
 */
export function canvasBackgroundOf(themeName: ThemeName): Rgba {
  return tokenColorOf(themeName, '--color-ground-mat');
}

/**
 * What an object's theme-aware `ink` colour draws as in each theme, read from the themes'
 * `--color-ink-primary` token (Figma's `ink/primary`): the one definition, which the
 * engine resolves ink with (`EngineHost.setTheme`). Pure.
 *
 * @returns Each theme's ink colour, opaque.
 */
export function inkColorsOfThemes(): Readonly<Record<InkTheme, Rgba>> {
  return {
    light: tokenColorOf('light', '--color-ink-primary'),
    dark: tokenColorOf('dark', '--color-ink-primary'),
  };
}

/**
 * Each theme's overlay palette under each chrome, worked out once: the same object for as long as
 * the page runs.
 */
let overlayPalettes:
  Readonly<Record<WhiteboardChrome, Readonly<Record<ThemeName, OverlayPalette>>>> | undefined;

/**
 * The editing states' colours in a theme (Figma "States"), read from its tokens:
 * `--color-hand-you` (the edited text's outline and highlight), `--color-mark-red-pencil` (guides
 * and gap runs), `--color-ink-secondary` (the hover outline) and `--color-ink-faint` (a locked
 * selection's dashed outline). Under the floating whiteboard chrome it also carries the whiteboard
 * design's selection: `--color-hand-you` for its marks, `--color-selection` for the
 * frame and the handles' edges (`hand/you`, darkened in Vellum to keep 3:1 on the mat)
 * and `--color-surface-sheet` inside its handles; under the classic chrome it has none, and the overlay keeps its own
 * selection. The same object for a theme and chrome every time, so a model carrying it compares
 * cheaply. Pure.
 *
 * @param themeName - The theme.
 * @param chrome - The shell's chrome; classic if absent.
 * @returns The palette, opaque colours.
 */
export function overlayPaletteOf(
  themeName: ThemeName,
  chrome: WhiteboardChrome = 'classic',
): OverlayPalette {
  const paletteOf = (theme: ThemeName): OverlayPalette => ({
    you: tokenColorOf(theme, '--color-hand-you'),
    guide: tokenColorOf(theme, '--color-mark-red-pencil'),
    hover: tokenColorOf(theme, '--color-ink-secondary'),
    locked: tokenColorOf(theme, '--color-ink-faint'),
  });
  const floatingOf = (classic: OverlayPalette, theme: ThemeName): OverlayPalette => ({
    ...classic,
    selection: {
      color: classic.you,
      frameColor: tokenColorOf(theme, '--color-selection'),
      handleFill: tokenColorOf(theme, '--color-surface-sheet'),
    },
  });
  if (overlayPalettes === undefined) {
    const classic = { light: paletteOf('light'), dark: paletteOf('dark') };
    const floating = {
      light: floatingOf(classic.light, 'light'),
      dark: floatingOf(classic.dark, 'dark'),
    };
    overlayPalettes = { classic, floating };
  }
  return overlayPalettes[chrome][themeName];
}
