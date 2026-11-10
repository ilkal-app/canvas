/// <reference types="node" />
// Hb-subset refuses what it cannot read rather than giving an empty font.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { parseFont } from '../font/parse-font.js';

import { createSubsetter } from './subsetter.js';

const WASM = readFileSync(
  createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
);

describe('createSubsetter', () => {
  it('throws for bytes that are not a font', async () => {
    const subsetter = await createSubsetter(WASM);
    expect(() => subsetter.subset(new Uint8Array([1, 2, 3, 4]), [0x41])).toThrow(Error);
  });

  it('allocates nothing when the characters iterator throws, so later calls still succeed', async () => {
    const subsetter = await createSubsetter(WASM);
    const font = new Uint8Array(
      readFileSync(
        new URL('../../../app/assets/fonts/script-coverage/notosansjp/400.ttf', import.meta.url),
      ),
    );
    function* failing(): Generator<number> {
      yield 0x4e00;
      throw new Error('stop');
    }
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(() => subsetter.subset(font, failing())).toThrow('stop');
    }
    expect(subsetter.subset(font, [0x4e00]).byteLength).toBeGreaterThan(0);
  });

  it('keeps every glyph id when asked, so text shaped with the whole font names its glyphs', async () => {
    const subsetter = await createSubsetter(WASM);
    const font = new Uint8Array(
      readFileSync(
        new URL('../../../app/assets/fonts/script-coverage/notosansjp/400.ttf', import.meta.url),
      ),
    );
    const whole = parseFont(font);
    const kept = subsetter.subset(font, [0x4e2d], { isRetainingGlyphIds: true });
    const renumbered = subsetter.subset(font, [0x4e2d]);
    const id = whole.glyphIdOf(0x4e2d);
    expect(parseFont(kept).glyphIdOf(0x4e2d)).toBe(id);
    expect(parseFont(kept).advanceOf(id)).toBe(whole.advanceOf(id));
    expect(parseFont(renumbered).glyphIdOf(0x4e2d)).not.toBe(id);
    expect(kept.byteLength).toBeLessThan(font.byteLength / 10);
  });
});
