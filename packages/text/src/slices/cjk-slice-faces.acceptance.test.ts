/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import * as text from '@canvas/text';

import type { FontFaceKey } from '../font/font-face.js';

const API = text as typeof text & {
  cjkSliceFace(face: FontFaceKey, id: string): FontFaceKey;
  cjkSliceIdOf(face: FontFaceKey): string | undefined;
};
const SC: FontFaceKey = { family: 'Noto Sans SC', weight: 400, isItalic: false };

it('round-trips a slice face and leaves ordinary named faces alone', () => {
  const slice = API.cjkSliceFace(SC, 'han-0');
  expect(slice).toEqual({ ...SC, postScriptName: 'cjk-slice:han-0' });
  expect(API.cjkSliceIdOf(slice)).toBe('han-0');
  expect(API.cjkSliceIdOf(SC)).toBeUndefined();
  expect(API.cjkSliceIdOf({ ...SC, postScriptName: 'NotoSansSC-Regular' })).toBeUndefined();
});

it('chooses real SC slice cmaps and carries each chosen slice name into fallback runs', async () => {
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  );
  const subsetter = await text.createSubsetter(wasm);
  const source = readFileSync(
    new URL('../../../app/assets/fonts/script-coverage/notosanssc/400.ttf', import.meta.url),
  );
  const files = text.buildCjkSlices(subsetter, SC.family, source);
  const candidates = [...files].map(([id, bytes]) => {
    const font = text.parseFont(bytes);
    const face = API.cjkSliceFace(SC, id);
    return { ...face, covers: (point: number) => font.glyphIdOf(point) !== 0 };
  });
  const style: TextStyle = {
    fontFamily: 'Liberation Sans',
    fontSize: 24,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  const own = { ...SC, family: 'Liberation Sans', covers: () => false };
  for (const [sample, id] of [
    ['中文', 'han-0'],
    ['か', 'base'],
  ] as const) {
    const runs = text.fallbackRuns(
      sample,
      [{ length: sample.length, style }],
      () => own,
      candidates,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.style).toMatchObject({
      fontFamily: SC.family,
      postScriptName: `cjk-slice:${id}`,
    });
  }
}, 60_000);
