import { describe, expect, it } from 'vitest';

import { INK_COLORS } from '@canvas/schema';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';
import { DEFAULT_PEN_STROKE } from '../tool-styles/pen-style.js';

import { canvasBackgroundOf, inkColorsOfThemes, overlayPaletteOf } from './canvas-background.js';
import { GRAPHITE_COLORS as DARK_COLORS, VELLUM_COLORS as LIGHT_COLORS } from './color-tokens.js';

type Rgb = readonly [number, number, number];

/**
 * A colour's relative luminance (WCAG 2.2).
 *
 * @param rgb - Its channels, 0 to 1.
 * @returns Its luminance, 0 to 1.
 */
function luminanceOf(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as unknown as Rgb;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The contrast ratio of two colours (WCAG 2.2).
 *
 * @param first - One colour.
 * @param second - The other.
 * @returns The ratio, 1 to 21.
 */
function contrastOf(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [luminanceOf(first), luminanceOf(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/**
 * A `#rrggbb` colour's channels.
 *
 * @param hex - The colour.
 * @returns Its channels, 0 to 1.
 */
function rgbOf(hex: string): Rgb {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map(
    (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  return [red, green, blue];
}

describe('the canvas background', () => {
  it('is an off-white in the light theme and an off-black in the dark, never pure', () => {
    expect(LIGHT_COLORS['--color-ground-mat']).toBe('#e6e5df');
    expect(DARK_COLORS['--color-ground-mat']).toBe('#232421');
    for (const colors of [LIGHT_COLORS, DARK_COLORS]) {
      expect(colors['--color-ground-mat'].toLowerCase()).not.toBe('#ffffff');
      expect(colors['--color-ground-mat'].toLowerCase()).not.toBe('#000000');
    }
  });

  it('reads the theme token as an opaque colour, channels 0 to 1', () => {
    expect(canvasBackgroundOf('light')).toEqual([...rgbOf('#e6e5df'), 1]);
    expect(canvasBackgroundOf('dark')).toEqual([...rgbOf('#232421'), 1]);
  });

  it('gives each theme’s text 7:1 or more against its canvas (WCAG AAA)', () => {
    for (const colors of [LIGHT_COLORS, DARK_COLORS]) {
      const ratio = contrastOf(
        rgbOf(colors['--color-ink-primary']),
        rgbOf(colors['--color-ground-mat']),
      );
      expect(ratio).toBeGreaterThanOrEqual(7);
    }
  });

  it('gives the default text 7:1 or more against the light canvas, and the pen ink', () => {
    const canvas = rgbOf(LIGHT_COLORS['--color-ground-mat']);
    const [red, green, blue] = DEFAULT_TEXT_STYLE.color as readonly number[];
    expect(contrastOf([red ?? 0, green ?? 0, blue ?? 0], canvas)).toBeGreaterThanOrEqual(7);
    // The pen draws in theme-aware ink since, resolved by the themes' ink token.
    expect(DEFAULT_PEN_STROKE.color).toBe('ink');
  });

  it('resolves ink from the themes’ ink/primary token, the schema’s INK_COLORS', () => {
    const inks = inkColorsOfThemes();
    expect(inks).toEqual(INK_COLORS);
    expect(inks.light).toEqual([...rgbOf(LIGHT_COLORS['--color-ink-primary']), 1]);
    // Vellum's #1e1f1c and Graphite's #ecebe5 on each theme's ground/mat.
    for (const theme of ['light', 'dark'] as const) {
      const [red, green, blue] = inks[theme];
      const canvas = canvasBackgroundOf(theme);
      expect(
        contrastOf([red, green, blue], [canvas[0], canvas[1], canvas[2]]),
      ).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('the overlay palette', () => {
  it('is each theme’s hand/you, red pencil, secondary and faint ink, as numbers, opaque', () => {
    for (const [theme, colors] of [
      ['light', LIGHT_COLORS],
      ['dark', DARK_COLORS],
    ] as const) {
      const palette = overlayPaletteOf(theme);
      expect(palette.you).toEqual([...rgbOf(colors['--color-hand-you']), 1]);
      expect(palette.guide).toEqual([...rgbOf(colors['--color-mark-red-pencil']), 1]);
      expect(palette.hover).toEqual([...rgbOf(colors['--color-ink-secondary']), 1]);
      expect(palette.locked).toEqual([...rgbOf(colors['--color-ink-faint']), 1]);
      // The same object every time, so a model carrying it compares cheaply.
      expect(overlayPaletteOf(theme)).toBe(palette);
    }
  });
});
