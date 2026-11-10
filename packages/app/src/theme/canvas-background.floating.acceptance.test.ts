import { describe, expect, it } from 'vitest';

import { overlayPaletteOf } from './canvas-background.js';

// The frame and the handles' edges are `--color-selection`: `hand/you` in Graphite, darkened in
// Vellum to #a9761a to keep 3:1 on the mat around a selected object (a ruling of the
// coordinator); every other mark stays `hand/you`.
const cases = [
  {
    theme: 'light',
    you: [183, 128, 28, 255],
    frame: [169, 118, 26, 255],
    sheet: [243, 242, 238, 255],
  },
  { theme: 'dark', you: [227, 169, 59, 255], frame: [227, 169, 59, 255], sheet: [43, 44, 41, 255] },
] as const;

describe('overlayPaletteOf floating chrome', () => {
  it.each(cases)(
    'keeps $theme classic byte-compatible and caches both chromes',
    ({ theme, you, frame, sheet }) => {
      const classic = overlayPaletteOf(theme);
      expect(overlayPaletteOf(theme, 'classic')).toBe(classic);
      expect(overlayPaletteOf(theme)).toBe(classic);
      expect(classic).not.toHaveProperty('selection');
      const floating = overlayPaletteOf(theme, 'floating');
      expect(floating).not.toBe(classic);
      expect(overlayPaletteOf(theme, 'floating')).toBe(floating);
      expect(floating).toEqual({
        ...classic,
        selection: {
          color: [you[0] / 255, you[1] / 255, you[2] / 255, 1],
          frameColor: [frame[0] / 255, frame[1] / 255, frame[2] / 255, 1],
          handleFill: [sheet[0] / 255, sheet[1] / 255, sheet[2] / 255, 1],
        },
      });
    },
  );
});
