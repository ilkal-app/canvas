import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from '@canvas/text';

import type { JobOutcome } from '../../workers/job-handlers.js';
import { glyphKeyOf } from '../atlas/glyph-key.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import type { MsdfJobRequest } from './msdf-job-payload.js';
import { createMsdfJobHandler } from './msdf-job.js';
import { rasterizeSdfGlyph } from './sdf-rasterizer.js';

const CORPUS = new URL('../../../../text/src/__fixtures__/format-corpus/', import.meta.url);
const TIER = BASE_TIER;

function fontBytes(file: string): ArrayBuffer {
  return new Uint8Array(readFileSync(new URL(file, CORPUS))).buffer;
}

function request(file: string, keys: readonly number[], bytes = fontBytes(file)): MsdfJobRequest {
  return {
    faceId: file,
    fontKey: file,
    fontBytes: bytes,
    keys,
    tier: TIER,
    field: 'sdf',
  };
}

async function settle(value: JobOutcome<'msdf'> | Promise<JobOutcome<'msdf'>>) {
  return await value;
}

describe('the HarfBuzz MSDF job raster path', () => {
  it('keeps TrueType SDF bytes and metrics identical for codepoint and shaped glyph keys', async () => {
    const bytes = fontBytes('corpus-sans-regular.ttf');
    const font = parseFont(bytes);
    const characters = ['A', 'o', 'g', ' '];
    const keys = characters.flatMap((character) => {
      const codepoint = character.codePointAt(0) ?? 0;
      return [codepoint, glyphKeyOf({ codepoint, glyphId: font.glyphIdOf(codepoint) })];
    });
    const handler = createMsdfJobHandler();
    const pending = handler(request('corpus-sans-regular.ttf', keys, bytes));
    expect(pending).toBeInstanceOf(Promise);
    const first = await settle(pending);
    expect(first.response.glyphs).toHaveLength(keys.length);
    for (const [index, glyph] of first.response.glyphs.entries()) {
      const codepoint = characters[Math.floor(index / 2)]?.codePointAt(0) ?? 0;
      const glyphId = font.glyphIdOf(codepoint);
      const expected = rasterizeSdfGlyph(font.outlineOf(glyphId), font.advanceOf(glyphId), TIER);
      expect(glyph.bitmap).toEqual(expected);
    }
    expect(handler(request('corpus-sans-regular.ttf', keys, bytes))).not.toBeInstanceOf(Promise);
  });

  it.each(['cff.otf', 'cff2.otf'])(
    'renders %s glyphs that the parser leaves blank, close to the TrueType face',
    async (format) => {
      const handler = createMsdfJobHandler();
      const characters = ['A', 'o', 'g'];
      const keys = characters.map((character) => character.codePointAt(0) ?? 0);
      const ttf = await settle(handler(request('corpus-sans-regular.ttf', keys)));
      const otfFile = `corpus-sans-regular.${format}`;
      const otfBytes = fontBytes(otfFile);
      const otf = await settle(handler(request(otfFile, keys, otfBytes)));
      const parsed = parseFont(otfBytes);
      for (const [index, glyph] of otf.response.glyphs.entries()) {
        const reference = ttf.response.glyphs[index]?.bitmap;
        if (reference === undefined) throw new Error('Missing TrueType reference bitmap');
        expect(parsed.outlineOf(parsed.glyphIdOf(keys[index] ?? 0)).contours).toEqual([]);
        const bitmap = glyph.bitmap;
        expect(bitmap.width).toBeGreaterThan(0);
        expect(bitmap.height).toBeGreaterThan(0);
        expect(bitmap.pixels.some((pixel) => pixel > 128)).toBe(true);
        expect(bitmap.advance).toBeCloseTo(reference.advance, 6);
        // Font conversion rounded implied midpoints to whole font units. Compare corresponding
        // raster positions even if that rounding shifts a padded bitmap edge by one pixel.
        let compared = 0;
        let maxDifference = 0;
        for (let row = 0; row < reference.height; row += 1) {
          for (let column = 0; column < reference.width; column += 1) {
            const x = reference.left + column - bitmap.left;
            const y = bitmap.top - reference.top + row;
            if (x < 0 || x >= bitmap.width || y < 0 || y >= bitmap.height) continue;
            const actual = bitmap.pixels[y * bitmap.width + x] ?? 0;
            const expected = reference.pixels[row * reference.width + column] ?? 0;
            maxDifference = Math.max(maxDifference, Math.abs(actual - expected));
            compared += 1;
          }
        }
        expect(compared).toBeGreaterThan(reference.pixels.length * 0.9);
        expect(maxDifference).toBeLessThanOrEqual(5);
      }
    },
  );

  it('contains a malformed face and still serves the next intact job', async () => {
    const handler = createMsdfJobHandler();
    const intact = fontBytes('corpus-sans-regular.ttf');
    const malformed = intact.slice(0, 12);
    const brokenRequest = request('truncated.ttf', [0x41], malformed);
    let broken: JobOutcome<'msdf'> | Promise<JobOutcome<'msdf'>> | undefined;
    expect(() => {
      broken = handler(brokenRequest);
    }).not.toThrow();
    if (broken === undefined) throw new Error('The malformed job did not return');
    const result = await Promise.resolve(broken).then(
      (outcome) => outcome,
      () => undefined,
    );
    if (result !== undefined) {
      expect(result.response.glyphs[0]?.bitmap).toMatchObject({ width: 0, height: 0 });
    }
    const good = await settle(handler(request('corpus-sans-regular.ttf', [0x41], intact)));
    expect(good.response.glyphs[0]?.bitmap.width).toBeGreaterThan(0);
  });
});
