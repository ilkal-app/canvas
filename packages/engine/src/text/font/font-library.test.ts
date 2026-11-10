import { describe, expect, it } from 'vitest';

import { fontFaceId } from '@canvas/text';
import { FontFormatError } from '@canvas/text';

import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import { FontLibrary } from './font-library.js';

function bundledLibrary(): FontLibrary {
  const library = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) library.addFace(face, bytes);
  return library;
}

describe('FontLibrary', () => {
  it('parses each added face and lists the faces in the order they were added', () => {
    const library = bundledLibrary();
    expect(library.faces.map(fontFaceId)).toEqual([
      `400|n|${BUNDLED_FAMILY}`,
      `700|n|${BUNDLED_FAMILY}`,
      `400|i|${BUNDLED_FAMILY}`,
      `700|i|${BUNDLED_FAMILY}`,
    ]);
    const bold = library.get(`700|n|${BUNDLED_FAMILY}`);
    expect(bold?.font.advanceOf(bold.font.glyphIdOf(65))).toBe(0.72216796875);
    expect(bold?.metrics.face).toEqual(bold?.face);
  });

  it('resolves a requested face with category and weight fallbacks', () => {
    const library = bundledLibrary();
    const wanted = { family: 'Helvetica', weight: 700, isItalic: false } as const;
    expect(library.resolve(wanted)?.faceId).toBe(`700|n|${BUNDLED_FAMILY}`);
    const bold = { family: BUNDLED_FAMILY, weight: 700, isItalic: false } as const;
    expect(library.resolve(bold)?.faceId).toBe(`700|n|${BUNDLED_FAMILY}`);
    expect(new FontLibrary().resolve(bold)).toBeUndefined();
  });

  it('keeps its own copy of the bytes, so the caller may transfer them', () => {
    const library = new FontLibrary();
    const [regular] = loadBundledFaces();
    if (regular === undefined) throw new Error('The bundled regular face is missing.');
    const loaded = library.addFace(regular.face, regular.bytes);
    new Uint8Array(regular.bytes).fill(0);
    expect(new Uint8Array(loaded.bytes).subarray(0, 4)).toEqual(new Uint8Array([0, 1, 0, 0]));
  });

  it('gives every added face a new font key, even when it replaces a face', () => {
    const library = new FontLibrary();
    const [regular] = loadBundledFaces();
    if (regular === undefined) throw new Error('The bundled regular face is missing.');
    const first = library.addFace(regular.face, regular.bytes);
    const second = library.addFace(regular.face, regular.bytes);
    expect(first.fontKey).not.toBe(second.fontKey);
    expect(library.faces).toHaveLength(1);
  });

  it('gives the same face loaded by two libraries different font keys', () => {
    const [regular] = loadBundledFaces();
    if (regular === undefined) throw new Error('The bundled regular face is missing.');
    // Libraries can share one job pool, whose workers cache fonts and resources by key.
    const first = new FontLibrary().addFace(regular.face, regular.bytes);
    const second = new FontLibrary().addFace(regular.face, regular.bytes);
    expect(first.faceId).toBe(second.faceId);
    expect(first.fontKey).not.toBe(second.fontKey);
  });

  it('rejects bytes that are not a font and keeps its faces', () => {
    const library = bundledLibrary();
    const face = { family: 'Broken', weight: 400, isItalic: false } as const;
    expect(() => library.addFace(face, new ArrayBuffer(8))).toThrow(FontFormatError);
    expect(library.faces).toHaveLength(4);
  });
});
