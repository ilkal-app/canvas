import { readFileSync } from 'node:fs';

import { expect, it, vi } from 'vitest';

import { loadShaper } from './shaper.js';

const BYTES = new Uint8Array(
  readFileSync(new URL('../__fixtures__/format-corpus/corpus-sans-regular.ttf', import.meta.url)),
);

it("refuses a face that is not the shaper's own, even under one of its ids", async () => {
  const shaper = await loadShaper();
  const face = shaper.face('outline-identity', BYTES);
  expect(shaper.outline(face, 36).contours.length).toBeGreaterThan(0);
  expect(() => shaper.outline({ ...face }, 36)).toThrow(RangeError);
  expect(() =>
    shaper.outline({ id: 'never-made', unitsPerEm: 1000, variations: {}, variationKey: '' }, 36),
  ).toThrow(RangeError);
});

it('draws nothing for a glyph id that is not a whole number', async () => {
  const shaper = await loadShaper();
  const face = shaper.face('outline-ids', BYTES);
  expect(shaper.outline(face, -1)).toEqual({ contours: [] });
  expect(shaper.outline(face, 1.5)).toEqual({ contours: [] });
});

it('draws nothing when HarfBuzz throws while drawing (a WebAssembly trap)', async () => {
  const shaper = await loadShaper();
  const face = shaper.face('outline-trap', BYTES);
  const harfbuzz = await import('harfbuzzjs');
  const drawGlyph = vi.spyOn(harfbuzz.Font.prototype, 'drawGlyph').mockImplementation(() => {
    throw new Error('RuntimeError: unreachable');
  });
  expect(shaper.outline(face, 36)).toEqual({ contours: [] });
  drawGlyph.mockRestore();
  expect(shaper.outline(face, 36).contours.length).toBeGreaterThan(0);
});
