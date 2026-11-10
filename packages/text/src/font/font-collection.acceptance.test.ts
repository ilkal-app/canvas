import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  collectionFaceCount,
  extractFace,
  FontFormatError,
  loadShaper,
  parseFont,
  postScriptNamesOf,
} from '@canvas/text';

/** The paired TTC and standalone sfnt faces built from the same corpus sources. */
const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const FACES = ['corpus-sans-regular', 'corpus-sans-bold'] as const;

function corpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, CORPUS)));
}

interface Reference {
  readonly glyphCount: number;
  readonly glyphs: Readonly<Record<string, { readonly glyphId: number }>>;
}

function referenceOf(face: string): Reference {
  return JSON.parse(readFileSync(new URL(`${face}.reference.json`, CORPUS), 'utf8')) as Reference;
}

function tagAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/**
 * Read the directory independently of the production sfnt reader.
 *
 * @param bytes - The sfnt file bytes.
 * @returns The table directory records.
 */
function recordsOf(bytes: Uint8Array): {
  tag: string;
  checksum: number;
  offset: number;
  length: number;
}[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  return Array.from({ length: count }, (unused, index) => {
    const at = 12 + index * 16;
    return {
      tag: tagAt(bytes, at),
      checksum: view.getUint32(at + 4),
      offset: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
    };
  });
}

/**
 * Turn the v1 fixture into a v2 TTC, shifting its absolute offsets by the added header bytes.
 *
 * @param bytes - The v1 collection bytes.
 * @returns The equivalent v2 collection bytes.
 */
function versionTwoCollection(bytes: Uint8Array): Uint8Array {
  const shifted = new Uint8Array(bytes.length + 12);
  shifted.set(bytes.subarray(0, 20));
  shifted.set(bytes.subarray(20), 32);
  const view = new DataView(shifted.buffer);
  view.setUint32(4, 0x00020000);
  for (let faceIndex = 0; faceIndex < 2; faceIndex += 1) {
    const oldOffset = view.getUint32(12 + faceIndex * 4);
    const faceOffset = oldOffset + 12;
    view.setUint32(12 + faceIndex * 4, faceOffset);
    const count = view.getUint16(faceOffset + 4);
    for (let index = 0; index < count; index += 1) {
      const tableOffsetAt = faceOffset + 12 + index * 16 + 8;
      view.setUint32(tableOffsetAt, view.getUint32(tableOffsetAt) + 12);
    }
  }
  return shifted;
}

/**
 * Sum the big-endian words of an sfnt, padding its final word with zero bytes.
 *
 * @param bytes - The sfnt file bytes.
 * @returns The unsigned 32-bit whole-file checksum.
 */
function wholeFileChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const word =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

describe('font collection acceptance', () => {
  const collection = corpusFile('corpus-sans.ttc');

  it('counts v1 and v2 collections and each plain TrueType, CFF and CFF2 sfnt', () => {
    expect(collectionFaceCount(collection)).toBe(2);
    expect(collectionFaceCount(versionTwoCollection(collection))).toBe(2);
    for (const face of FACES) {
      for (const extension of ['ttf', 'cff.otf', 'cff2.otf']) {
        expect(collectionFaceCount(corpusFile(`${face}.${extension}`))).toBe(1);
      }
    }
    const trueSfnt = corpusFile('corpus-sans-regular.ttf');
    trueSfnt.set([0x74, 0x72, 0x75, 0x65]);
    expect(collectionFaceCount(trueSfnt)).toBe(1);
  });

  it('rejects web formats, garbage, truncated headers, zero faces and face offsets past EOF', () => {
    for (const extension of ['woff', 'woff2']) {
      expect(() => collectionFaceCount(corpusFile(`corpus-sans-regular.${extension}`))).toThrow(
        FontFormatError,
      );
    }
    expect(() => collectionFaceCount(new Uint8Array(20).fill(0x78))).toThrow(FontFormatError);
    expect(() => collectionFaceCount(collection.subarray(0, 11))).toThrow(FontFormatError);
    expect(() => collectionFaceCount(collection.subarray(0, 19))).toThrow(FontFormatError);
    const zeroFaces = collection.slice();
    new DataView(zeroFaces.buffer).setUint32(8, 0);
    expect(() => collectionFaceCount(zeroFaces)).toThrow(FontFormatError);
    const badOffset = collection.slice();
    new DataView(badOffset.buffer).setUint32(12, badOffset.length);
    expect(() => collectionFaceCount(badOffset)).toThrow(FontFormatError);
    const truncatedSfnt = corpusFile('corpus-sans-regular.ttf').subarray(0, 11);
    expect(() => collectionFaceCount(truncatedSfnt)).toThrow(FontFormatError);
    expect(() => postScriptNamesOf(badOffset)).toThrow(FontFormatError);
  });

  it.each(FACES.map((face, faceIndex) => ({ face, faceIndex })))(
    'extracts $face as an independently parseable, drawable sfnt',
    async ({ face, faceIndex }) => {
      const source = corpusFile('corpus-sans.ttc');
      const before = source.slice();
      const extracted = extractFace(source, faceIndex);
      const standalone = corpusFile(`${face}.ttf`);
      const actual = parseFont(extracted);
      const expected = parseFont(standalone);
      expect([actual.unitsPerEm, actual.ascent, actual.descent]).toEqual([
        expected.unitsPerEm,
        expected.ascent,
        expected.descent,
      ]);
      expect(actual.characterMap()).toEqual(expected.characterMap());
      for (let glyphId = 0; glyphId < referenceOf(face).glyphCount; glyphId += 1) {
        expect(actual.advanceOf(glyphId)).toBe(expected.advanceOf(glyphId));
        expect(actual.outlineOf(glyphId)).toEqual(expected.outlineOf(glyphId));
      }
      const shaper = await loadShaper();
      const extractedFace = shaper.face(`collection-acceptance-${face}`, extracted);
      const standaloneFace = shaper.face(`standalone-acceptance-${face}`, standalone);
      expect(extractedFace.unitsPerEm).toBe(standaloneFace.unitsPerEm);
      for (const { glyphId } of Object.values(referenceOf(face).glyphs)) {
        expect(shaper.outline(extractedFace, glyphId)).toEqual(
          shaper.outline(standaloneFace, glyphId),
        );
      }
      expect(source).toEqual(before);
    },
  );

  it.each([0, 1])(
    'writes face %i with aligned, bounded, nonoverlapping tables and correct search fields',
    (faceIndex) => {
      const extracted = extractFace(collection, faceIndex);
      const view = new DataView(extracted.buffer, extracted.byteOffset, extracted.byteLength);
      const count = view.getUint16(4);
      const largestPowerOfTwo = 2 ** Math.floor(Math.log2(count));
      expect(view.getUint16(6)).toBe(largestPowerOfTwo * 16);
      expect(view.getUint16(8)).toBe(Math.log2(largestPowerOfTwo));
      expect(view.getUint16(10)).toBe(count * 16 - largestPowerOfTwo * 16);
      expect(wholeFileChecksum(extracted)).toBe(0xb1b0afba);
      const records = recordsOf(extracted);
      expect(records).toHaveLength(count);
      const standalone = corpusFile(`${String(FACES[faceIndex])}.ttf`);
      const standaloneRecords = recordsOf(standalone);
      expect(records.map(({ tag }) => tag)).toEqual(standaloneRecords.map(({ tag }) => tag));
      for (const record of records) {
        expect(record.offset % 4).toBe(0);
        expect(record.offset).toBeGreaterThanOrEqual(12 + count * 16);
        expect(record.offset + record.length).toBeLessThanOrEqual(extracted.length);
        const original = standaloneRecords.find(({ tag }) => tag === record.tag);
        expect(record.checksum).toBe(original?.checksum);
        expect(record.length).toBe(original?.length);
        if (original !== undefined) {
          const actualBytes = extracted.slice(record.offset, record.offset + record.length);
          const expectedBytes = standalone.slice(
            original.offset,
            original.offset + original.length,
          );
          if (record.tag === 'head') {
            actualBytes.fill(0, 8, 12);
            expectedBytes.fill(0, 8, 12);
          }
          expect(actualBytes).toEqual(expectedBytes);
        }
      }
      const nonempty = records
        .filter(({ length }) => length > 0)
        .sort((left, right) => left.offset - right.offset);
      for (let index = 1; index < nonempty.length; index += 1) {
        const previous = nonempty[index - 1];
        const next = nonempty[index];
        expect(next?.offset).toBeGreaterThanOrEqual(
          (previous?.offset ?? 0) + (previous?.length ?? 0),
        );
        expect(
          extracted.subarray((previous?.offset ?? 0) + (previous?.length ?? 0), next?.offset),
        ).toEqual(
          new Uint8Array((next?.offset ?? 0) - (previous?.offset ?? 0) - (previous?.length ?? 0)),
        );
      }
    },
  );

  it('passes a plain sfnt through at index zero and rejects invalid indices and out-of-bounds tables', () => {
    const plain = corpusFile('corpus-sans-regular.ttf');
    const before = plain.slice();
    expect(extractFace(plain, 0)).toEqual(plain);
    expect(plain).toEqual(before);
    for (const invalid of [-1, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => extractFace(plain, invalid)).toThrow(FontFormatError);
    }
    for (const invalid of [-1, 2, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => extractFace(collection, invalid)).toThrow(FontFormatError);
    }
    const corrupt = collection.slice();
    const view = new DataView(corrupt.buffer);
    const firstFace = view.getUint32(12);
    view.setUint32(firstFace + 12 + 8, corrupt.length - 1);
    view.setUint32(firstFace + 12 + 12, 16);
    expect(() => extractFace(corrupt, 0)).toThrow(FontFormatError);
  });

  it('extracts both faces from a version 2 collection', () => {
    const versionTwo = versionTwoCollection(collection);
    for (const faceIndex of [0, 1]) {
      expect(extractFace(versionTwo, faceIndex)).toEqual(extractFace(collection, faceIndex));
    }
  });

  it('returns the name ID 6 PostScript names per collection face and per plain sfnt', () => {
    const before = collection.slice();
    expect(postScriptNamesOf(collection)).toEqual(['CorpusSans-Regular', 'CorpusSans-Bold']);
    expect(collection).toEqual(before);
    expect(postScriptNamesOf(versionTwoCollection(collection))).toEqual([
      'CorpusSans-Regular',
      'CorpusSans-Bold',
    ]);
    expect(postScriptNamesOf(corpusFile('corpus-sans-regular.ttf'))).toEqual([
      'CorpusSans-Regular',
    ]);
    expect(postScriptNamesOf(corpusFile('corpus-sans-bold.ttf'))).toEqual(['CorpusSans-Bold']);
  });

  it('returns undefined without name ID 6 and respects ArrayBufferView boundaries', () => {
    const unnamed = corpusFile('corpus-sans-regular.ttf');
    const name = recordsOf(unnamed).find(({ tag }) => tag === 'name');
    expect(name).toBeDefined();
    if (name === undefined) return;
    const view = new DataView(unnamed.buffer);
    const nameCount = view.getUint16(name.offset + 2);
    for (let index = 0; index < nameCount; index += 1) {
      const nameIdAt = name.offset + 6 + index * 12 + 6;
      if (view.getUint16(nameIdAt) === 6) view.setUint16(nameIdAt, 5);
    }
    expect(postScriptNamesOf(unnamed)).toEqual([undefined]);
    const padded = new Uint8Array(collection.length + 8);
    padded.set(collection, 4);
    const slice = padded.subarray(4, 4 + collection.length);
    expect(collectionFaceCount(slice)).toBe(2);
    expect(postScriptNamesOf(slice)).toEqual(['CorpusSans-Regular', 'CorpusSans-Bold']);
    expect(extractFace(slice, 1)).toEqual(extractFace(collection.buffer, 1));
    expect(padded.subarray(0, 4)).toEqual(new Uint8Array(4));
    expect(padded.subarray(4 + collection.length)).toEqual(new Uint8Array(4));
  });
});
