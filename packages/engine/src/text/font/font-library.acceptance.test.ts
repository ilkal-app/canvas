import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fontFaceId, type FontFaceKey } from '@canvas/text';

import { FontLibrary } from './font-library.js';

type NamedFace = FontFaceKey & { readonly postScriptName?: string };
const plain: NamedFace = { family: 'Private Sans', weight: 400, isItalic: false };
const named: NamedFace = { ...plain, postScriptName: 'PrivateSans-Condensed' };

/**
 * Reads a bundled TrueType face as an independent transferable buffer.
 *
 * @param file - Fixture filename.
 * @returns The file bytes.
 */
function bytesOf(file: string): ArrayBuffer {
  const bytes = readFileSync(new URL(`../../../assets/fonts/${file}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('FontLibrary named faces', () => {
  it('retains a plain and named face of equal weight and slant and resolves each', () => {
    const library = new FontLibrary();
    library.addFace(plain, bytesOf('LiberationSans-Regular.ttf'));
    library.addFace(named, bytesOf('LiberationSans-Bold.ttf'));
    expect(library.faces).toEqual([plain, named]);
    expect(library.get(fontFaceId(plain))?.face).toEqual(plain);
    expect(library.get(fontFaceId(named))?.face).toEqual(named);
    expect(library.resolve(plain)?.face).toEqual(plain);
    expect(library.resolve(named)?.face).toEqual(named);
  });
});
