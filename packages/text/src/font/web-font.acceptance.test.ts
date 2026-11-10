// Acceptance summary:
// - Signatures distinguish WOFF/WOFF2 without throwing; plain sfnts and collections copy through.
// - Every corpus web face preserves sfnt tables, parser metrics, maps, kerning and every outline.
// - Both decoded formats have aligned, bounded, nonoverlapping tables and valid search fields.
// - Truncation, bad headers, oversized declarations, corrupt streams and broken transforms reject.
// - A seeded mutation sweep contains all failures as FontFormatError and leaves inputs unchanged.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as text from '@canvas/text';
import { FontFormatError, loadShaper, parseFont } from '@canvas/text';

// The public exports are intentionally absent until the implementation lands.
interface WebFontApi {
  readonly decodeWebFont: (bytes: ArrayBufferLike | ArrayBufferView) => Promise<Uint8Array>;
  readonly webFontFormatOf: (
    bytes: ArrayBufferLike | ArrayBufferView,
  ) => 'woff' | 'woff2' | undefined;
}

const { decodeWebFont, webFontFormatOf } = text as typeof text & WebFontApi;

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const FACES = ['corpus-sans-regular', 'corpus-sans-bold', 'corpus-serif-regular'] as const;
const WEB_FORMATS = ['woff', 'woff2'] as const;

function corpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, CORPUS)));
}

function dataViewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function tagAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

interface TableRecord {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

function recordsOf(bytes: Uint8Array): TableRecord[] {
  const view = dataViewOf(bytes);
  const count = view.getUint16(4);
  return Array.from({ length: count }, (unused, index) => {
    const at = 12 + index * 16;
    return {
      tag: tagAt(bytes, at),
      offset: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
    };
  });
}

function tableBytes(bytes: Uint8Array, record: TableRecord): Uint8Array {
  return bytes.slice(record.offset, record.offset + record.length);
}

function glyphCountOf(bytes: Uint8Array): number {
  const maxp = recordsOf(bytes).find(({ tag }) => tag === 'maxp');
  if (maxp === undefined) throw new Error('Corpus fixture lacks maxp.');
  return dataViewOf(bytes).getUint16(maxp.offset + 4);
}

function expectWellFormedDirectory(bytes: Uint8Array): void {
  const view = dataViewOf(bytes);
  const count = view.getUint16(4);
  const directoryEnd = 12 + 16 * count;
  expect(directoryEnd).toBeLessThanOrEqual(bytes.length);
  const power = 2 ** Math.floor(Math.log2(count));
  expect(view.getUint16(6)).toBe(power * 16);
  expect(view.getUint16(8)).toBe(Math.log2(power));
  expect(view.getUint16(10)).toBe(count * 16 - power * 16);
  const records = recordsOf(bytes);
  expect(new Set(records.map(({ tag }) => tag)).size).toBe(count);
  for (const record of records) {
    expect(record.offset % 4).toBe(0);
    expect(record.offset).toBeGreaterThanOrEqual(directoryEnd);
    expect(record.offset + record.length).toBeLessThanOrEqual(bytes.length);
  }
  const occupied = records.filter(({ length }) => length > 0).sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < occupied.length; index += 1) {
    const previous = occupied[index - 1];
    const next = occupied[index];
    expect(next?.offset).toBeGreaterThanOrEqual((previous?.offset ?? 0) + (previous?.length ?? 0));
  }
}

function expectParsedFaceEqual(decoded: Uint8Array, original: Uint8Array): void {
  const actual = parseFont(decoded);
  const expected = parseFont(original);
  expect([actual.unitsPerEm, actual.ascent, actual.descent]).toEqual([
    expected.unitsPerEm,
    expected.ascent,
    expected.descent,
  ]);
  expect(actual.characterMap()).toEqual(expected.characterMap());
  expect(actual.kerningPairs()).toEqual(expected.kerningPairs());
  for (let glyphId = 0; glyphId < glyphCountOf(original); glyphId += 1) {
    expect(actual.advanceOf(glyphId)).toBe(expected.advanceOf(glyphId));
    expect(actual.outlineOf(glyphId)).toEqual(expected.outlineOf(glyphId));
  }
  for (const [left, right] of expected.kerningPairs()) {
    expect(actual.kerningOf(left, right)).toBe(expected.kerningOf(left, right));
  }
}

function expectTablesEqual(decoded: Uint8Array, original: Uint8Array, format: string): void {
  const actual = recordsOf(decoded);
  const expected = recordsOf(original);
  expect(actual.map(({ tag }) => tag).sort()).toEqual(expected.map(({ tag }) => tag).sort());
  for (const record of actual) {
    const source = expected.find(({ tag }) => tag === record.tag);
    expect(source).toBeDefined();
    if (source === undefined) continue;
    if (format === 'woff2' && (record.tag === 'glyf' || record.tag === 'loca')) continue;
    const actualBytes = tableBytes(decoded, record);
    const expectedBytes = tableBytes(original, source);
    expect(actualBytes.length).toBe(expectedBytes.length);
    if (format === 'woff2' && record.tag === 'head') {
      actualBytes.fill(0, 8, 12);
      expectedBytes.fill(0, 8, 12);
      const actualFlags = dataViewOf(actualBytes).getUint16(16);
      const expectedFlags = dataViewOf(expectedBytes).getUint16(16);
      expect(actualFlags & ~0x0800).toBe(expectedFlags & ~0x0800);
      actualBytes[16] = expectedBytes[16] ?? 0;
      actualBytes[17] = expectedBytes[17] ?? 0;
    }
    expect(actualBytes).toEqual(expectedBytes);
  }
}

function changed(bytes: Uint8Array, at: number, value: number): Uint8Array {
  const copy = bytes.slice();
  copy[at] = value;
  return copy;
}

function writeUint32(bytes: Uint8Array, at: number, value: number): Uint8Array {
  const copy = bytes.slice();
  dataViewOf(copy).setUint32(at, value);
  return copy;
}

function nextRandom(state: { value: number }): number {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value;
}

/**
 * WOFF2's variable-length unsigned integer, used to find a transformed glyf length.
 *
 * @param bytes - The WOFF2 file.
 * @param start - Offset of the first integer byte.
 * @returns The value and the offset following it.
 * @throws {Error} When the corpus fixture has an invalid integer.
 */
function base128At(bytes: Uint8Array, start: number): { value: number; end: number } {
  let value = 0;
  for (let at = start; at < Math.min(start + 5, bytes.length); at += 1) {
    const byte = bytes[at] ?? 0;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, end: at + 1 };
  }
  throw new Error('Corpus WOFF2 has an invalid UIntBase128.');
}

function woff2GlyfTransformLengthAt(bytes: Uint8Array): number {
  const count = dataViewOf(bytes).getUint16(12);
  let at = 48;
  for (let index = 0; index < count; index += 1) {
    const flags = bytes[at] ?? 0;
    at += 1;
    const tagIndex = flags & 0x3f;
    if (tagIndex === 0x3f) at += 4;
    at = base128At(bytes, at).end;
    // In WOFF2, glyf and loca version 0 are transformed; other tags use version 1.
    const isTransformed = tagIndex === 10 || tagIndex === 11 ? flags >> 6 === 0 : flags >> 6 !== 0;
    if (isTransformed) {
      const lengthAt = at;
      at = base128At(bytes, at).end;
      if (tagIndex === 10) return lengthAt;
    }
  }
  throw new Error('Corpus WOFF2 lacks transformed glyf.');
}

describe('web font acceptance', () => {
  it('recognises only the two complete web signatures, synchronously and without throwing', () => {
    expect(webFontFormatOf(new Uint8Array([0x77, 0x4f, 0x46, 0x46]))).toBe('woff');
    expect(webFontFormatOf(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toBe('woff2');
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array([0x77, 0x4f, 0x46]),
      new Uint8Array([0x77, 0x4f, 0x46, 0x31]),
      corpusFile('corpus-sans-regular.ttf'),
    ]) {
      expect(webFontFormatOf(bytes)).toBeUndefined();
    }
    const padded = new Uint8Array([0, 0x77, 0x4f, 0x46, 0x32, 0]);
    expect(webFontFormatOf(padded.subarray(1, 5))).toBe('woff2');
    expect(webFontFormatOf(new DataView(padded.buffer, 1, 4))).toBe('woff2');
  });

  it.each(['ttf', 'cff.otf', 'cff2.otf', 'ttc'])(
    'copies plain %s bytes without mutation',
    async (kind) => {
      const name = kind === 'ttc' ? 'corpus-sans.ttc' : `corpus-sans-regular.${kind}`;
      const source = corpusFile(name);
      const before = source.slice();
      const decoded = await decodeWebFont(source);
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded).toEqual(before);
      expect(decoded).not.toBe(source);
      decoded[0] = 0;
      expect(source).toEqual(before);
      const asBuffer = await decodeWebFont(source.slice().buffer);
      expect(asBuffer).toEqual(before);
    },
  );

  it.each(FACES.flatMap((face) => WEB_FORMATS.map((format) => [face, format] as const)))(
    'decodes %s.%s with preserved tables, metrics and every parser and HarfBuzz outline',
    async (face, format) => {
      const source = corpusFile(`${face}.${format}`);
      const before = source.slice();
      const original = corpusFile(`${face}.ttf`);
      const decoded = await decodeWebFont(source);
      expect(decoded).toBeInstanceOf(Uint8Array);
      const padded = new Uint8Array(source.length + 2);
      padded.set(source, 1);
      expect(await decodeWebFont(new DataView(padded.buffer, 1, source.length))).toEqual(decoded);
      expectWellFormedDirectory(decoded);
      expectTablesEqual(decoded, original, format);
      expectParsedFaceEqual(decoded, original);
      const shaper = await loadShaper();
      const actualFace = shaper.face(`web-${face}-${format}`, decoded);
      const expectedFace = shaper.face(`ttf-${face}-${format}`, original);
      expect(actualFace.unitsPerEm).toBe(expectedFace.unitsPerEm);
      for (let glyphId = 0; glyphId < glyphCountOf(original); glyphId += 1) {
        expect(shaper.outline(actualFace, glyphId)).toEqual(shaper.outline(expectedFace, glyphId));
      }
      expect(source).toEqual(before);
    },
    30_000,
  );

  it.each(WEB_FORMATS)(
    'rejects truncated %s headers, directories and compressed streams',
    async (format) => {
      const source = corpusFile(`corpus-sans-regular.${format}`);
      const header = format === 'woff' ? 44 : 48;
      for (const length of [
        4,
        11,
        header - 1,
        header,
        header + 1,
        Math.floor(source.length / 2),
        source.length - 1,
      ]) {
        await expect(decodeWebFont(source.subarray(0, length))).rejects.toBeInstanceOf(
          FontFormatError,
        );
      }
    },
  );

  it('rejects inconsistent WOFF directories, absurd sizes and corrupt zlib data', async () => {
    const source = corpusFile('corpus-sans-regular.woff');
    const view = dataViewOf(source);
    await expect(decodeWebFont(changed(source, 0, 0))).rejects.toBeInstanceOf(FontFormatError);
    await expect(decodeWebFont(writeUint32(source, 4, 0xdeadbeef))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 16, 0xffffffff))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 44 + 12, 0xffffffff))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 44 + 4, source.length))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 44 + 8, source.length))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    const count = view.getUint16(12);
    let compressed: Uint8Array | undefined;
    for (let index = 0; index < count; index += 1) {
      const at = 44 + index * 20;
      const offset = view.getUint32(at + 4);
      const size = view.getUint32(at + 8);
      if (size < view.getUint32(at + 12) && size > 4) {
        compressed = source.slice();
        compressed.fill(0, offset, offset + size);
        break;
      }
    }
    expect(compressed).toBeDefined();
    if (compressed !== undefined) {
      await expect(decodeWebFont(compressed)).rejects.toBeInstanceOf(FontFormatError);
    }
  });

  it('rejects invalid WOFF2 headers, collections, corrupt brotli and inconsistent glyf transforms', async () => {
    const source = corpusFile('corpus-sans-regular.woff2');
    await expect(decodeWebFont(changed(source, 0, 0))).rejects.toBeInstanceOf(FontFormatError);
    await expect(decodeWebFont(writeUint32(source, 4, 0xdeadbeef))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 16, 0xffffffff))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 20, 0xffffffff))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    await expect(decodeWebFont(writeUint32(source, 4, 0x74746366))).rejects.toThrow(/collection/i);
    await expect(decodeWebFont(writeUint32(source, 4, 0x74746366))).rejects.toBeInstanceOf(
      FontFormatError,
    );
    const corrupt = source.slice();
    corrupt.fill(0, Math.floor(source.length / 2), source.length - 1);
    await expect(decodeWebFont(corrupt)).rejects.toBeInstanceOf(FontFormatError);
    const inconsistent = source.slice();
    const lengthAt = woff2GlyfTransformLengthAt(inconsistent);
    const length = base128At(inconsistent, lengthAt);
    inconsistent[length.end - 1] = (inconsistent[length.end - 1] ?? 0) ^ 1;
    await expect(decodeWebFont(inconsistent)).rejects.toBeInstanceOf(FontFormatError);
  });

  it.each(FACES.flatMap((face) => WEB_FORMATS.map((format) => [face, format] as const)))(
    'contains 300 seeded mutations of %s.%s and never changes input',
    async (face, format) => {
      const source = corpusFile(`${face}.${format}`);
      const before = source.slice();
      const state = { value: 0x51150004 ^ source.length };
      for (let iteration = 0; iteration < 300; iteration += 1) {
        const mutated = source.slice();
        const count = 1 + (nextRandom(state) % 8);
        for (let index = 0; index < count; index += 1) {
          const at = nextRandom(state) % mutated.length;
          mutated[at] = nextRandom(state) & 0xff;
        }
        const unchanged = mutated.slice();
        try {
          expect(await decodeWebFont(mutated)).toBeInstanceOf(Uint8Array);
        } catch (error) {
          expect(error).toBeInstanceOf(FontFormatError);
        }
        expect(mutated).toEqual(unchanged);
      }
      expect(source).toEqual(before);
    },
    120_000,
  );
});
