import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from '@canvas/text';

import { GLYPH_PADDING_PX } from '../atlas/glyph-bitmap.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import type { ColourCanvasFactory, ColourContext2d } from '../colour/colour-canvas.js';

import type { MsdfJobRequest } from './msdf-job-payload.js';
import { createMsdfJobHandler } from './msdf-job.js';

const COLOUR_FONTS = new URL(
  '../../../../text/src/shaping/__fixtures__/color-fonts/',
  import.meta.url,
);

function fontBytes(file: string): ArrayBuffer {
  return new Uint8Array(readFileSync(new URL(file, COLOUR_FONTS))).buffer;
}

function request(file: string, keys: readonly number[]): MsdfJobRequest {
  return {
    faceId: file,
    fontKey: file,
    fontBytes: fontBytes(file),
    keys,
    tier: BASE_TIER,
    field: 'sdf',
  };
}

class FakeColourCanvas implements ColourCanvasFactory {
  readonly decoded: Uint8Array[] = [];
  readonly sizes: (readonly [number, number])[] = [];
  readonly image = { image: true };
  readonly drawnImages: unknown[] = [];

  create(width: number, height: number) {
    this.sizes.push([width, height] as const);
    const gradient = { addColorStop: () => undefined };
    const context: ColourContext2d = {
      save: () => undefined,
      restore: () => undefined,
      transform: () => undefined,
      setTransform: () => undefined,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      quadraticCurveTo: () => undefined,
      bezierCurveTo: () => undefined,
      closePath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      fillRect: () => undefined,
      clearRect: () => undefined,
      fillStyle: '',
      globalCompositeOperation: 'source-over',
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      createConicGradient: () => gradient,
      drawImage: (image: unknown) => {
        this.drawnImages.push(image);
      },
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => undefined,
      getImageData: (...args: [number, number, number, number]) => {
        const [, , w, h] = args;
        const data = new Uint8ClampedArray(w * h * 4);
        data.set([255, 0, 0, 128]);
        return { data };
      },
    };
    return {
      width,
      height,
      getContext: () => context,
    };
  }

  decodePng(bytes: Uint8Array): Promise<unknown> {
    this.decoded.push(bytes);
    return Promise.resolve(this.image);
  }
}

describe('the MSDF job with a colour canvas', () => {
  it('rasterises shaped colour glyphs at the requested tier while preserving ordinary glyphs', async () => {
    const file = 'test_glyphs-glyf_colr_1.ttf';
    const font = parseFont(fontBytes(file));
    const canvas = new FakeColourCanvas();
    const keys = [-1 - 12, -1 - 90, -1 - 93, -1 - 0];
    const result = await createMsdfJobHandler({ colourCanvas: canvas })(request(file, keys));
    expect(result.response.glyphs.map(({ key, bitmap }) => [key, bitmap.field])).toEqual([
      [-13, 'colour'],
      [-91, 'colour'],
      [-94, 'colour'],
      [-1, 'sdf'],
    ]);
    for (const glyph of result.response.glyphs.slice(0, 3)) {
      const id = -1 - glyph.key;
      const bitmap = glyph.bitmap;
      const advancePx = font.advanceOf(id) * BASE_TIER;
      const ascentPx = font.ascent * BASE_TIER;
      const descentPx = font.descent * BASE_TIER;
      expect(bitmap.advance).toBeCloseTo(advancePx);
      expect(bitmap.width).toBeGreaterThanOrEqual(Math.ceil(advancePx) + 2 * GLYPH_PADDING_PX);
      expect(bitmap.height).toBeGreaterThanOrEqual(
        Math.ceil((font.ascent + font.descent) * BASE_TIER) + 2 * GLYPH_PADDING_PX,
      );
      expect(bitmap.left).toBeLessThanOrEqual(-GLYPH_PADDING_PX);
      expect(bitmap.top).toBeGreaterThanOrEqual(ascentPx + GLYPH_PADDING_PX);
      expect(bitmap.left).toBeGreaterThanOrEqual(-BASE_TIER - GLYPH_PADDING_PX);
      expect(bitmap.top).toBeLessThanOrEqual(ascentPx + BASE_TIER + GLYPH_PADDING_PX);
      // Ceil-sized bitmaps may add less than one pixel at the right and bottom edges.
      expect(bitmap.left + bitmap.width).toBeLessThanOrEqual(
        advancePx + BASE_TIER + GLYPH_PADDING_PX + 1,
      );
      expect(bitmap.top - bitmap.height).toBeGreaterThanOrEqual(
        -descentPx - BASE_TIER - GLYPH_PADDING_PX - 1,
      );
      if (id === 12) {
        expect(bitmap.left).toBe(-GLYPH_PADDING_PX);
        expect(bitmap.top).toBe(ascentPx + GLYPH_PADDING_PX);
        expect(bitmap.width).toBe(Math.ceil(advancePx) + 2 * GLYPH_PADDING_PX);
        expect(bitmap.height).toBe(
          Math.ceil((font.ascent + font.descent) * BASE_TIER) + 2 * GLYPH_PADDING_PX,
        );
      } else if (id === 90 || id === 93) {
        expect(bitmap.top).toBeGreaterThanOrEqual(BASE_TIER + GLYPH_PADDING_PX);
        expect(bitmap.height).toBeGreaterThanOrEqual(
          Math.ceil((1 + font.descent) * BASE_TIER) + 2 * GLYPH_PADDING_PX,
        );
      }
      expect(bitmap.pixels).toHaveLength(bitmap.width * bitmap.height * 4);
      expect([...bitmap.pixels.slice(0, 4)]).toEqual([128, 0, 0, 128]);
    }
    expect(canvas.sizes).toHaveLength(3);
    expect(result.transfer).toEqual(
      result.response.glyphs.map(({ bitmap }) => bitmap.pixels.buffer),
    );
  });

  it('maps codepoint keys through cmap before looking up colour paint', async () => {
    const file = 'test_glyphs-glyf_colr_1.ttf';
    const font = parseFont(fontBytes(file));
    const mapped = font.characterMap().find(([, glyphId]) => glyphId === 90);
    if (mapped === undefined)
      throw new Error('The colour test font has no cmap entry for glyph 90');
    const canvas = new FakeColourCanvas();
    const result = await createMsdfJobHandler({ colourCanvas: canvas })(request(file, [mapped[0]]));
    expect(result.response.glyphs[0]?.bitmap.field).toBe('colour');
    expect(canvas.sizes).toHaveLength(1);
  });

  it('keeps the existing distance field path without a canvas', async () => {
    const file = 'test_glyphs-glyf_colr_1.ttf';
    const result = await createMsdfJobHandler()(request(file, [-1 - 90]));
    expect(result.response.glyphs[0]?.bitmap.field).toBe('sdf');
  });

  it('decodes an sbix PNG once and includes its colour bitmap in the job response', async () => {
    const file = 'samples-sbix.ttf';
    const canvas = new FakeColourCanvas();
    const result = await createMsdfJobHandler({ colourCanvas: canvas })(request(file, [-1 - 19]));
    expect(result.response.glyphs[0]?.bitmap.field).toBe('colour');
    expect(canvas.decoded).toHaveLength(1);
    expect([...(canvas.decoded[0]?.slice(0, 8) ?? [])]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(canvas.drawnImages).toContain(canvas.image);
  });
});
