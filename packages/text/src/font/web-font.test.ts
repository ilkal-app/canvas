import { afterEach, describe, expect, it, vi } from 'vitest';

import { corpus, expectRefusal, tableOf, woffFile } from '../__fixtures__/web-font-files.js';

import { parseFont } from './parse-font.js';
import { decodeWebFont, MAX_DECODED_FONT_BYTES } from './web-font.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeWebFont', () => {
  it('rebuilds a transformed hmtx from the glyphs’ xMin as fontTools encodes it', async () => {
    const ttf = corpus('corpus-sans-regular.ttf');
    const decoded = await decodeWebFont(corpus('corpus-sans-regular.hmtx.woff2'));
    expect([...tableOf(decoded, 'hmtx')]).toEqual([...tableOf(ttf, 'hmtx')]);
    const [expected, actual] = [parseFont(ttf), parseFont(decoded)];
    for (let glyph = 0; glyph < 300; glyph += 1) {
      expect(actual.advanceOf(glyph), String(glyph)).toBe(expected.advanceOf(glyph));
    }
  });

  it('refuses bytes that are no font at all', async () => {
    await expectRefusal(new Uint8Array([1, 2, 3, 4, 5]), /not a font/);
    await expectRefusal(new Uint8Array(2), /not a font/);
  });

  describe('WOFF', () => {
    const name = Uint8Array.from({ length: 64 }, (unused, index) => index % 7);

    it('keeps stored tables, an empty directory and its recorded checksums', async () => {
      const decoded = await decodeWebFont(
        woffFile([{ tag: 'name', data: name, isCompressed: false }]),
      );
      expect([...tableOf(decoded, 'name')]).toEqual([...name]);
      expect([...(await decodeWebFont(woffFile([])))]).toEqual([
        0,
        1,
        0,
        0,
        ...new Array<number>(8).fill(0),
      ]);
    });

    it('refuses a directory, a table or a total past the file or the limit', async () => {
      const file = woffFile([{ tag: 'name', data: name }]);
      const view = new DataView(file.buffer);
      view.setUint16(12, 400);
      await expectRefusal(file, /directory runs past/);
      const past = woffFile([{ tag: 'name', data: name }]);
      new DataView(past.buffer).setUint32(44 + 8, 4000);
      await expectRefusal(past, /runs past the end/);
      const huge = woffFile([
        { tag: 'aaaa', data: new Uint8Array(0), isCompressed: false, length: 40 * 2 ** 20 },
        { tag: 'bbbb', data: new Uint8Array(0), isCompressed: false, length: 40 * 2 ** 20 },
      ]);
      await expectRefusal(huge, /past the limit/);
    });

    it('refuses a table longer compressed than whole, or inflating to another length', async () => {
      await expectRefusal(woffFile([{ tag: 'name', data: name, length: 2 }]), /longer compressed/);
      await expectRefusal(woffFile([{ tag: 'name', data: name, length: 40 }]), /inflates past/);
      await expectRefusal(woffFile([{ tag: 'name', data: name, length: 200 }]), /inflates short/);
      const corrupt = woffFile([{ tag: 'name', data: name }]);
      corrupt.fill(0xff, 44 + 20, 44 + 20 + 6);
      await expectRefusal(corrupt, /not a valid zlib stream/);
    });

    it('refuses a repeated tag', async () => {
      const twice = woffFile([
        { tag: 'name', data: name, isCompressed: false },
        { tag: 'name', data: name, isCompressed: false },
      ]);
      await expectRefusal(twice, /appears twice/);
    });

    it('says so on a platform without DecompressionStream', async () => {
      vi.stubGlobal('DecompressionStream', undefined);
      await expectRefusal(woffFile([{ tag: 'name', data: name }]), /cannot inflate/);
    });
  });
});

describe('decodeWebFont: plain font files', () => {
  it('refuses a font file past the size limit instead of copying it', async () => {
    const huge = new Uint8Array(MAX_DECODED_FONT_BYTES + 4);
    huge.set([0, 1, 0, 0]);
    await expectRefusal(huge, /past the limit/);
  });
});
