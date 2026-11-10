import { readFileSync } from 'node:fs';

import type * as HarfBuzzModule from 'harfbuzzjs';
import { expect, it } from 'vitest';

import * as textExports from '../index.js';

import * as shaperExports from './shaper.js';
import type { Shaper } from './shaper.js';

type BoundedShaper = Shaper & { readonly retainedFaceBytes: number };
const { createShaper } = shaperExports as typeof shaperExports & {
  createShaper: (hb: typeof HarfBuzzModule, options?: { maxFaceBytes?: number }) => BoundedShaper;
};
const { shapeText } = shaperExports;

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const sans = new Uint8Array(readFileSync(new URL('corpus-sans-regular.ttf', CORPUS)));
const serif = new Uint8Array(readFileSync(new URL('corpus-serif-regular.ttf', CORPUS)));
const cff = new Uint8Array(readFileSync(new URL('corpus-sans-regular.cff.otf', CORPUS)));
const variable = new Uint8Array(readFileSync(new URL('corpus-sans-variable.ttf', CORPUS)));

it('exports the default 128 MiB face budget', () => {
  const bound = 'MAX_SHAPER_FACE_BYTES' in textExports && textExports.MAX_SHAPER_FACE_BYTES;
  expect(bound).toBe(128 * 1024 * 1024);
});

it('counts file bytes, evicts the least recently used id, and reloads an identical face', async () => {
  const hb = await import('harfbuzzjs');
  const maxFaceBytes = Math.max(
    sans.length + serif.length,
    sans.length + cff.length,
    serif.length + cff.length,
  );
  const shaper = createShaper(hb, { maxFaceBytes });
  expect(shaper.retainedFaceBytes).toBe(0);

  const originalSans = shaper.face('sans', sans);
  expect(shaper.retainedFaceBytes).toBe(sans.length);
  const originalSerif = shaper.face('serif', serif);
  expect(shaper.retainedFaceBytes).toBe(sans.length + serif.length);
  const text = 'AV office';
  const before = shapeText(shaper, originalSerif, text, 0, text.length);
  const outlineBefore = shaper.outline(originalSerif, 36);
  expect(outlineBefore.contours.length).toBeGreaterThan(0);

  expect(shaper.face('sans', cff)).toBe(originalSans);
  const originalCff = shaper.face('cff', cff);
  expect(shaper.retainedFaceBytes).toBe(sans.length + cff.length);
  expect(shaper.face('sans', sans)).toBe(originalSans);
  expect(shaper.face('cff', cff)).toBe(originalCff);

  const reloadedSerif = shaper.face('serif', serif);
  expect(reloadedSerif).not.toBe(originalSerif);
  expect(shaper.retainedFaceBytes).toBe(cff.length + serif.length);
  expect(shapeText(shaper, reloadedSerif, text, 0, text.length).glyphs).toEqual(before.glyphs);
  expect(shaper.outline(reloadedSerif, 36)).toEqual(outlineBefore);
  expect(shapeText(shaper, originalSerif, text, 0, text.length).glyphs).toEqual(before.glyphs);
  expect(shaper.outline(originalSerif, 36)).toEqual(outlineBefore);
});

it('keeps one file even when it exceeds the configured budget', async () => {
  const hb = await import('harfbuzzjs');
  const shaper = createShaper(hb, { maxFaceBytes: 1 });
  const face = shaper.face('oversize', sans);
  expect(shaper.retainedFaceBytes).toBe(sans.length);
  expect(shapeText(shaper, face, 'A', 0, 1).glyphs).toHaveLength(1);
  shaper.face('next', serif);
  expect(shaper.retainedFaceBytes).toBe(serif.length);
  expect(shapeText(shaper, face, 'A', 0, 1).glyphs).toHaveLength(1);
});

it('counts variable instances once per file and keeps held instances usable after eviction', async () => {
  const hb = await import('harfbuzzjs');
  const shaper = createShaper(hb, { maxFaceBytes: variable.length });
  const regular = shaper.face('variable', variable, { wght: 400 });
  const bold = shaper.face('variable', variable, { wght: 700 });
  expect(shaper.retainedFaceBytes).toBe(variable.length);
  const before = shapeText(shaper, bold, 'AV', 0, 2).glyphs;
  shaper.face('static', sans);
  expect(shaper.retainedFaceBytes).toBe(sans.length);
  expect(shapeText(shaper, regular, 'AV', 0, 2).glyphs).toHaveLength(2);
  expect(shapeText(shaper, bold, 'AV', 0, 2).glyphs).toEqual(before);
});
