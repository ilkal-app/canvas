/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import * as text from '@canvas/text';
import type { FontFaceKey } from '@canvas/text';

import { FontLibrary } from '../font/font-library.js';

import { layoutTextNow } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';
import { libraryShaping } from './layout-shaping.js';

const API = text as typeof text & { cjkSliceFace(face: FontFaceKey, id: string): FontFaceKey };
const FACE: FontFaceKey = { family: 'Noto Sans SC', weight: 400, isItalic: false };
const SAMPLE = '中文かな、漢字ABC';
const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

it('matches whole-face shaped advances, positions and line breaks across SC slices', async () => {
  const source = readFileSync(
    new URL('../../../../app/assets/fonts/script-coverage/notosanssc/400.ttf', import.meta.url),
  );
  const liberation = readFileSync(
    new URL('../../../assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
  );
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  );
  const slices = text.buildCjkSlices(await text.createSubsetter(wasm), FACE.family, source);
  const whole = new FontLibrary();
  const sliced = new FontLibrary();
  for (const library of [whole, sliced])
    library.addFace(
      { family: 'Liberation Sans', weight: 400, isItalic: false },
      Uint8Array.from(liberation).buffer,
    );
  whole.addFace(FACE, Uint8Array.from(source).buffer);
  for (const [id, bytes] of slices)
    sliced.addFace(API.cjkSliceFace(FACE, id), Uint8Array.from(bytes).buffer);
  const shaper = await text.loadShaper();
  const input = {
    objectId: 'cjk',
    text: SAMPLE,
    runs: [{ length: SAMPLE.length, style: STYLE }],
    maxWidth: 140,
    align: 'left',
  } as const;
  const layout = (library: FontLibrary) =>
    layoutTextNow(createLayoutJobRequest(input, library), libraryShaping(library, shaper));
  const expected = layout(whole);
  const actual = layout(sliced);
  expect(actual.width).toBeCloseTo(expected.width, 5);
  expect(
    actual.lines.map(({ start, end, isHard, width }) => ({ start, end, isHard, width })),
  ).toEqual(expected.lines.map(({ start, end, isHard, width }) => ({ start, end, isHard, width })));
  expect(
    actual.glyphs.map(({ index, end, advance, x, y, line }) => ({
      index,
      end,
      advance,
      x,
      y,
      line,
    })),
  ).toEqual(
    expected.glyphs.map(({ index, end, advance, x, y, line }) => ({
      index,
      end,
      advance,
      x,
      y,
      line,
    })),
  );
}, 60_000);
