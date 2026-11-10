import { describe, expect, it } from 'vitest';

import { DISTANCE_RANGE_PX, GLYPH_PADDING_PX } from '../atlas/glyph-bitmap.js';

import { FakeMsdfgenModule } from './__fixtures__/fake-msdfgen-module.js';
import { generateMsdfGlyph, loadMsdfgenFont } from './msdf-generator.js';

describe('loadMsdfgenFont', () => {
  it('copies the bytes into the module and frees the vector', () => {
    const module = new FakeMsdfgenModule();
    const font = loadMsdfgenFont(module, new Uint8Array([1, 2, 3]).buffer);
    expect(module.loadedBytes).toEqual([[1, 2, 3]]);
    expect(module.liveVectors).toBe(0);
    expect(font).toBeDefined();
  });

  it('throws when msdfgen cannot read the font', () => {
    const module = new FakeMsdfgenModule({ canLoad: false });
    expect(() => loadMsdfgenFont(module, new ArrayBuffer(4))).toThrow(/cannot read/);
    expect(module.liveFonts).toBe(0);
  });
});

describe('generateMsdfGlyph', () => {
  it('sizes the bitmap from the pixel-snapped bounds plus padding and aligns the shape to it', () => {
    const module = new FakeMsdfgenModule();
    const font = loadMsdfgenFont(module, new ArrayBuffer(4));
    // Bounds 0.1..0.5 em wide, -0.2..0.7 em tall, at 64 px per em: 6..32 px and -13..45 px.
    module.shape = { advance: 0.55, left: 0.1, bottom: -0.2, right: 0.5, top: 0.7 };
    const glyph = generateMsdfGlyph(font, 0x67, 64);
    const pad = GLYPH_PADDING_PX;
    expect(glyph).toMatchObject({
      field: 'msdf',
      width: 32 - 6 + 2 * pad,
      height: 45 - -13 + 2 * pad,
      left: 6 - pad,
      top: 45 + pad,
      advance: 0.55 * 64,
    });
    expect(module.generateCalls).toEqual([
      {
        codepoint: 0x67,
        width: glyph.width,
        height: glyph.height,
        range: DISTANCE_RANGE_PX,
        translateX: (pad - 6) / 64,
        translateY: (pad + 13) / 64,
        scale: 64,
      },
    ]);
  });

  it('copies the RGB bytes out and frees them in the module', () => {
    const module = new FakeMsdfgenModule();
    const font = loadMsdfgenFont(module, new ArrayBuffer(4));
    module.shape = { advance: 0.5, left: 0, bottom: 0, right: 0.01, top: 0.01 };
    const glyph = generateMsdfGlyph(font, 0x2e, 64);
    expect(glyph.pixels).toHaveLength(glyph.width * glyph.height * 3);
    expect([...glyph.pixels.subarray(0, 6)]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(module.liveBitmaps).toBe(0);
  });

  it('gives a glyph with no outline an empty bitmap without generating', () => {
    const module = new FakeMsdfgenModule();
    const font = loadMsdfgenFont(module, new ArrayBuffer(4));
    module.shape = { advance: 0.28, left: 0, bottom: 0, right: 0, top: 0 };
    expect(generateMsdfGlyph(font, 0x20, 64)).toMatchObject({
      width: 0,
      height: 0,
      advance: 0.28 * 64,
    });
    expect(module.generateCalls).toEqual([]);
  });
});
