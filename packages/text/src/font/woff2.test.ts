import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  expectRefusal,
  type GlyfStreams,
  glyphFile,
  readSimpleGlyph,
  tableOf,
  transformedGlyf,
  u16,
  uint255,
  type Woff2Table,
  woff2File,
} from '../__fixtures__/web-font-files.js';

import { decodeWebFont, MAX_DECODED_FONT_BYTES } from './web-font.js';

describe('decodeWebFont: WOFF2', () => {
  it('refuses a zero tag, an unknown transform and malformed numbers', async () => {
    await expectRefusal(woff2File([{ tag: 0, data: new Uint8Array(4) }]), /unknown tag/);
    await expectRefusal(
      woff2File([{ tag: 'cmap', data: new Uint8Array(4), version: 1, length: 8 }]),
      /unknown transform/,
    );
    const directory = (bytes: number[]): Uint8Array => {
      const file = woff2File([{ tag: 'cmap', data: new Uint8Array(4) }]);
      const out = new Uint8Array(file.length + bytes.length);
      out.set(file.subarray(0, 53));
      out.set(bytes, 53);
      out.set(file.subarray(54), 53 + bytes.length);
      new DataView(out.buffer).setUint32(8, out.length);
      return out;
    };
    await expectRefusal(directory([0x80, 0x01]), /leading zero/);
    await expectRefusal(directory([0x90, 0x80, 0x80, 0x80, 0x00]), /overflows/);
    await expectRefusal(directory([0x81, 0x80, 0x80, 0x80, 0x80, 0x00]), /past five bytes/);
  });

  it('refuses declared sizes past the limit and a stream past the file', async () => {
    const big = MAX_DECODED_FONT_BYTES + 1;
    await expectRefusal(
      woff2File([{ tag: 'glyf', data: new Uint8Array(4), length: big }]),
      /past the limit/,
    );
    await expectRefusal(
      woff2File([
        { tag: 'aaaa', data: new Uint8Array(0), length: 40 * 2 ** 20 },
        { tag: 'bbbb', data: new Uint8Array(0), length: 40 * 2 ** 20 },
      ]),
      /WOFF2 stream declares/,
    );
    const many = woff2File([{ tag: 'aaaa', data: new Uint8Array(0) }], {
      stream: Uint8Array.from(brotliCompressSync(new Uint8Array(0))),
    });
    new DataView(many.buffer).setUint32(20, 4000);
    await expectRefusal(many, /stream runs past/);
  });

  it('refuses a corrupt brotli stream and one decoding short of its tables', async () => {
    await expectRefusal(
      woff2File([{ tag: 'name', data: new Uint8Array(8) }], {
        stream: new Uint8Array([0x8b, 0xff, 0xff, 0xff]),
      }),
      /not a valid brotli stream/,
    );
    await expectRefusal(
      woff2File([{ tag: 'name', data: new Uint8Array(8) }], {
        stream: Uint8Array.from(brotliCompressSync(new Uint8Array(4))),
      }),
      /short of its tables/,
    );
  });

  it('refuses glyf without loca, mixed transforms, a stored loca and a wrong loca length', async () => {
    const glyf = transformedGlyf({ contours: [0] });
    await expectRefusal(woff2File([{ tag: 'glyf', data: glyf, length: 1 }]), /both glyf and loca/);
    await expectRefusal(
      woff2File([
        { tag: 'glyf', data: glyf, length: 1 },
        { tag: 'loca', data: new Uint8Array(8), version: 3 },
      ]),
      /both be transformed/,
    );
    await expectRefusal(
      woff2File([
        { tag: 'glyf', data: glyf, length: 1 },
        { tag: 'loca', data: new Uint8Array(8), length: 8 },
      ]),
      /must be empty/,
    );
    await expectRefusal(
      woff2File([
        { tag: 'glyf', data: glyf, length: 1 },
        { tag: 'loca', data: new Uint8Array(0), length: 12 },
      ]),
      /rebuilt loca/,
    );
  });

  it('copies glyf and loca stored untransformed', async () => {
    const glyf = Uint8Array.from([1, 2, 3, 4]);
    const loca = Uint8Array.from([0, 0, 0, 2]);
    const decoded = await decodeWebFont(
      woff2File([
        { tag: 'glyf', data: glyf, version: 3 },
        { tag: 'loca', data: loca, version: 3 },
        { tag: 'head', data: new Uint8Array(6) },
      ]),
    );
    expect([...tableOf(decoded, 'glyf')]).toEqual([...glyf]);
    expect([...tableOf(decoded, 'loca')]).toEqual([...loca]);
    expect([...tableOf(decoded, 'head')]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('decodes every coordinate triplet, an explicit box, instructions and the overlap flag', async () => {
    // One contour, one point per triplet form: dy only, dx only, a nibble each, and the 2-, 3-
    // and 4-byte forms, each with both signs positive; the last point is off the curve.
    const decoded = await decodeWebFont(
      glyphFile({
        contours: [1, 0],
        points: uint255(6),
        flags: [0x01, 0x0b, 0x17, 0x57, 0x7b, 0x80 | 0x7f],
        glyphs: [5, 7, 0x23, 0x01, 0x02, 0x12, 0x34, 0x56, 0x01, 0x00, 0x02, 0x00, ...uint255(2)],
        instructions: [0xb0, 0x01],
        boxBitmap: [0x80, 0, 0, 0],
        boxes: [-10, -20, 1000, 2000],
        overlap: [0x80],
      }),
    );
    const glyph = readSimpleGlyph(tableOf(decoded, 'glyf'));
    expect(glyph.box).toEqual([-10, -20, 1000, 2000]);
    expect(glyph.ends).toEqual([5]);
    expect(glyph.instructions).toEqual([0xb0, 0x01]);
    expect((glyph.flags[0] ?? 0) & 0x40).toBe(0x40);
    expect(glyph.flags.map((flag) => flag & 1)).toEqual([1, 1, 1, 1, 1, 0]);
    expect(glyph.points).toEqual([
      [0, 5],
      [7, 5],
      [10, 9],
      [12, 12],
      [12 + 0x123, 12 + 0x456],
      [12 + 0x123 + 0x100, 12 + 0x456 + 0x200],
    ]);
    const loca = new DataView(tableOf(decoded, 'loca').slice().buffer);
    expect(loca.getUint32(4)).toBe(loca.getUint32(8));
  });

  it('reads 255UInt16 counts in every form and bounds a glyph from its points', async () => {
    const decoded = await decodeWebFont(
      glyphFile({
        contours: [3],
        points: [...uint255(1), ...uint255(0), ...uint255(0)],
        flags: [0x01],
        glyphs: [9, ...uint255(0)],
        indexFormat: 0,
      }),
    );
    const glyph = readSimpleGlyph(tableOf(decoded, 'glyf'));
    expect(glyph.box).toEqual([0, 9, 0, 9]);
    expect(glyph.ends).toEqual([0, 0, 0]);
    const pointless = await decodeWebFont(
      glyphFile({ contours: [1], points: uint255(0), glyphs: uint255(0) }),
    );
    const view = new DataView(tableOf(pointless, 'glyf').slice().buffer);
    expect([2, 4, 6, 8].map((offset) => view.getInt16(offset))).toEqual([0, 0, 0, 0]);
    for (const count of [300, 600, 1000]) {
      const file = glyphFile({ contours: [1], points: uint255(count) });
      await expectRefusal(file, /truncated/);
    }
  });

  it('copies composite glyphs, with each argument form and their instructions', async () => {
    const component = (flags: number, extra: number[]): number[] => [
      ...u16(flags),
      ...u16(1),
      ...extra,
    ];
    const composites = [
      ...component(0x0020 | 0x0001, [0, 1, 0, 2]),
      ...component(0x0020 | 0x0008, [3, 4, 0x40, 0]),
      ...component(0x0020 | 0x0040, [5, 6, 0x40, 0, 0x40, 0]),
      ...component(0x0100 | 0x0080, [7, 8, 0x40, 0, 0, 0, 0, 0, 0x40, 0]),
    ];
    const decoded = await decodeWebFont(
      glyphFile({
        contours: [-1, -1],
        composites: [...composites, ...component(0, [1, 2])],
        glyphs: uint255(3),
        instructions: [0xb0, 0x02, 0x03],
        boxBitmap: [0xc0, 0, 0, 0],
        boxes: [1, 2, 3, 4, 5, 6, 7, 8],
      }),
    );
    const glyf = tableOf(decoded, 'glyf');
    const view = new DataView(glyf.slice().buffer);
    expect(view.getInt16(0)).toBe(-1);
    expect([1, 2, 3, 4].map((value, index) => view.getInt16(2 + index * 2))).toEqual([1, 2, 3, 4]);
    expect([...glyf.subarray(10, 10 + composites.length)]).toEqual(composites);
    expect(view.getUint16(10 + composites.length)).toBe(3);
    expect([...glyf.subarray(12 + composites.length, 15 + composites.length)]).toEqual([
      0xb0, 0x02, 0x03,
    ]);
  });

  it('refuses empty glyphs with a box, composites without one and odd contour counts', async () => {
    await expectRefusal(
      glyphFile({ contours: [0], boxBitmap: [0x80, 0, 0, 0], boxes: [0, 0, 1, 1] }),
      /empty WOFF2 glyph has a bounding box/,
    );
    await expectRefusal(
      glyphFile({ contours: [-1], composites: [0, 0, 0, 1, 0, 0] }),
      /composite glyph has no bounding box/,
    );
    await expectRefusal(glyphFile({ contours: [-2] }), /negative contour count/);
  });

  it('refuses too many points, a coordinate past 16 bits and a short loca overflowing', async () => {
    await expectRefusal(
      glyphFile({ contours: [2], points: [...uint255(65535), ...uint255(1)] }),
      /too many points/,
    );
    await expectRefusal(
      glyphFile({
        contours: [1],
        points: uint255(2),
        flags: [0x7d, 0x7d],
        glyphs: [0x9c, 0x40, 0, 0, 0x9c, 0x40, 0, 0, 0],
      }),
      /outside 16 bits/,
    );
    const longInstructions = new Array<number>(60000).fill(0);
    await expectRefusal(
      glyphFile({
        contours: [1, 1, 1],
        indexFormat: 0,
        points: [1, 1, 1],
        flags: [0x01, 0x01, 0x01],
        glyphs: [0, ...uint255(60000), 0, ...uint255(60000), 0, ...uint255(60000)],
        instructions: [...longInstructions, ...longInstructions, ...longInstructions],
      }),
      /too long for a short loca/,
    );
  });

  it('rebuilds a transformed hmtx for each set of flags and refuses inconsistent ones', async () => {
    const hhea = (metrics: number): Woff2Table => ({
      tag: 'hhea',
      data: Uint8Array.from([...new Array<number>(34).fill(0), ...u16(metrics)]),
    });
    const maxp = (glyphs: number): Woff2Table => ({
      tag: 'maxp',
      data: Uint8Array.from([0, 0, 0x50, 0, ...u16(glyphs)]),
    });
    const streams: GlyfStreams = {
      contours: [1, 1, 0],
      points: [1, 1],
      flags: [0x15, 0x15],
      glyphs: [0x23, 0, 0x45, 0],
    };
    const hmtx = (flags: number, values: number[], length = 10): Woff2Table => ({
      tag: 'hmtx',
      version: 1,
      length,
      data: Uint8Array.from([flags, ...values.flatMap(u16)]),
    });
    const decode = async (table: Woff2Table): Promise<number[]> => {
      const decoded = await decodeWebFont(glyphFile(streams, [hhea(2), maxp(3), table]));
      const bytes = tableOf(decoded, 'hmtx');
      const view = new DataView(bytes.slice().buffer);
      return Array.from({ length: 5 }, (unused, index) => view.getInt16(index * 2));
    };
    // Glyph xMins: 3 and 5 (the triplets' dx), and 0 for the empty glyph.
    expect(await decode(hmtx(1, [500, 600, 7]))).toEqual([500, 3, 600, 5, 7]);
    expect(await decode(hmtx(2, [500, 600, 8, 9]))).toEqual([500, 8, 600, 9, 0]);
    expect(await decode(hmtx(3, [500, 600]))).toEqual([500, 3, 600, 5, 0]);
    for (const flags of [0, 4]) {
      await expectRefusal(
        glyphFile(streams, [hhea(2), maxp(3), hmtx(flags, [500, 600, 1, 2, 3])]),
        /invalid flags/,
      );
    }
    await expectRefusal(
      glyphFile(streams, [hhea(2), maxp(3), hmtx(3, [500, 600], 12)]),
      /rebuilt hmtx/,
    );
    await expectRefusal(glyphFile(streams, [hhea(4), maxp(3), hmtx(3, [500, 600])]), /disagrees/);
    await expectRefusal(glyphFile(streams, [maxp(3), hmtx(3, [500, 600])]), /needs/);
    await expectRefusal(
      woff2File([hhea(2), maxp(3), hmtx(3, [500, 600])]),
      /needs a transformed glyf/,
    );
  });

  it('computes checksums over tables whose length is not a multiple of four', async () => {
    const decoded = await decodeWebFont(
      woff2File([{ tag: 'name', data: Uint8Array.from([1, 2, 3, 4, 5]) }]),
    );
    const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    expect(view.getUint32(12 + 4)).toBe((0x01020304 + 0x05000000) >>> 0);
  });

  it('refuses a brotli stream decoding past its tables without growing its output', async () => {
    // 20 MiB of zeros in a few bytes: the patched decoder stops at the 8 bytes declared.
    const bomb = Uint8Array.from(
      brotliCompressSync(new Uint8Array(20 * 2 ** 20), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 1 },
      }),
    );
    await expectRefusal(
      woff2File([{ tag: 'name', data: new Uint8Array(8) }], { stream: bomb }),
      /not a valid brotli stream/,
    );
  });

  it('refuses glyf and loca at transform versions WOFF2 does not define', async () => {
    for (const tag of ['glyf', 'loca']) {
      for (const version of [1, 2]) {
        await expectRefusal(
          woff2File([{ tag, data: new Uint8Array(4), version, length: 4 }]),
          /unknown transform/,
        );
      }
    }
  });

  it('refuses a table that appears twice', async () => {
    await expectRefusal(
      woff2File([
        { tag: 'name', data: new Uint8Array(4) },
        { tag: 'name', data: new Uint8Array(4) },
      ]),
      /appears twice/,
    );
  });

  it('decodes a brotli stream whose metadata block is longer than its output', async () => {
    // Built by hand (RFC 7932): a 16-bit window, a 200-byte metadata block, an uncompressed
    // block of the 8 table bytes, and an empty last block. Metadata writes no output, so it must
    // not count against the 8 bytes the directory declares.
    const bits: number[] = [];
    const put = (value: number, count: number): void => {
      for (let bit = 0; bit < count; bit += 1) bits.push((value >> bit) & 1);
    };
    const align = (): void => {
      while (bits.length % 8 !== 0) bits.push(0);
    };
    const table = [1, 2, 3, 4, 5, 6, 7, 8];
    put(0, 1);
    put(0, 1);
    put(3, 2);
    put(0, 1);
    put(1, 2);
    put(199, 8);
    align();
    for (let index = 0; index < 200; index += 1) put(0xaa, 8);
    put(0, 1);
    put(0, 2);
    put(table.length - 1, 16);
    put(1, 1);
    align();
    for (const byte of table) put(byte, 8);
    put(1, 1);
    put(1, 1);
    align();
    const stream = Uint8Array.from({ length: bits.length / 8 }, (unused, index) =>
      bits.slice(index * 8, index * 8 + 8).reduce((byte, bit, shift) => byte | (bit << shift), 0),
    );
    expect([...brotliDecompressSync(stream)]).toEqual(table);
    const decoded = await decodeWebFont(
      woff2File([{ tag: 'name', data: Uint8Array.from(table) }], { stream }),
    );
    expect([...tableOf(decoded, 'name')]).toEqual(table);
  });
});
