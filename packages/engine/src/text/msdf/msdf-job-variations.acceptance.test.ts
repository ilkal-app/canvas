/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { FakeMsdfgenModule } from './__fixtures__/fake-msdfgen-module.js';
import type { MsdfJobRequest } from './msdf-job-payload.js';
import { createMsdfJobHandler } from './msdf-job.js';

const faceId = '400|n|Corpus Sans Variable';
const bytes = readFileSync(
  new URL(
    '../../../../text/src/__fixtures__/format-corpus/corpus-sans-variable.ttf',
    import.meta.url,
  ),
);

function request(overrides: Partial<MsdfJobRequest> = {}): MsdfJobRequest {
  return {
    faceId,
    fontKey: `${faceId}#variable`,
    fontBytes: Uint8Array.from(bytes).buffer,
    keys: [0x41],
    tier: BASE_TIER,
    field: 'msdf',
    ...overrides,
  };
}

describe('MSDF job variable outlines', () => {
  it('rasterizes the requested instance even when msdfgen is available', async () => {
    const module = new FakeMsdfgenModule();
    const handler = createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) });
    const bold = await handler(
      request({ faceId: `${faceId}@wght=700`, variations: { wght: 700 } }),
    );
    const bitmap = bold.response.glyphs[0]?.bitmap;

    expect(bold.response.faceId).toBe(`${faceId}@wght=700`);
    expect(bitmap?.field).toBe('sdf');
    expect(bitmap?.pixels.some((pixel) => pixel > 128)).toBe(true);
    expect(module.generateCalls).toEqual([]);
  });

  it('draws a visibly heavier A than the default from the same base font bytes', async () => {
    const handler = createMsdfJobHandler();
    const regular = await handler(request({ field: 'sdf' }));
    const bold = await handler(
      request({ faceId: `${faceId}@wght=700`, variations: { wght: 700 }, field: 'sdf' }),
    );
    const regularBitmap = regular.response.glyphs[0]?.bitmap;
    const boldBitmap = bold.response.glyphs[0]?.bitmap;
    if (regularBitmap === undefined || boldBitmap === undefined) {
      throw new Error('missing A bitmap');
    }
    const inside = (pixels: Uint8Array) => pixels.filter((pixel) => pixel > 128).length;

    expect(regularBitmap.field).toBe('sdf');
    expect(boldBitmap.field).toBe('sdf');
    expect(inside(regularBitmap.pixels)).toBeGreaterThan(0);
    expect(inside(boldBitmap.pixels)).toBeGreaterThan(inside(regularBitmap.pixels) * 1.2);
  });

  it('still generates the default request with msdfgen', async () => {
    const module = new FakeMsdfgenModule();
    const handler = createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) });
    const output = await handler(request());

    expect(output.response.faceId).toBe(faceId);
    expect(output.response.glyphs.map(({ key, bitmap }) => [key, bitmap.field])).toEqual([
      [0x41, 'msdf'],
    ]);
    expect(module.generateCalls.map(({ codepoint }) => codepoint)).toEqual([0x41]);
  });
});
