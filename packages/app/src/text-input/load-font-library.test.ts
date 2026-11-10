import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { FONT_FACE_SOURCES, FONT_FAMILIES } from './font-catalogue.js';
import { loadFontLibrary } from './load-font-library.js';

/**
 * Reads a catalogue file from disk, as `fetch` would serve it.
 *
 * @param url - The file's `file:` URL.
 * @returns The bytes.
 */
function readFile(url: string): Promise<ArrayBuffer> {
  const bytes = readFileSync(fileURLToPath(url));
  return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe('the font catalogue', () => {
  it('offers the curated families while bootstrapping only the four default faces', () => {
    // 32 owner families with Inter Variable (owner-approved 2026-10-18), and Liberation Sans.
    expect(FONT_FAMILIES).toHaveLength(33);
    expect(FONT_FAMILIES.map(({ family }) => family)).toEqual(
      expect.arrayContaining(['Geist', 'Lora', 'JetBrains Mono', 'Caveat']),
    );
    expect(FONT_FACE_SOURCES).toHaveLength(4);
    expect(FONT_FACE_SOURCES[0]).toMatchObject({
      family: 'Liberation Sans',
      weight: 400,
      isItalic: false,
    });
  });

  it('loads every face in catalogue order, so the default face is the same on every thread', async () => {
    const { fonts, loaded } = loadFontLibrary(FONT_FACE_SOURCES, () => undefined, readFile);
    expect(fonts.faces).toEqual([]);
    expect(fonts.contentIdentity).toBeUndefined();
    await loaded;
    expect(fonts.contentIdentity).toMatch(/^font-set:v1:/);
    expect(
      fonts.faces.map(
        ({ family, weight, isItalic }) => `${family} ${String(weight)} ${String(isItalic)}`,
      ),
    ).toEqual(
      FONT_FACE_SOURCES.map(
        ({ family, weight, isItalic }) => `${family} ${String(weight)} ${String(isItalic)}`,
      ),
    );
  });

  it('reports a file that fails to load or parse and loads the rest', async () => {
    const onError = vi.fn();
    const [first, second] = FONT_FACE_SOURCES;
    if (first === undefined || second === undefined) throw new Error('empty catalogue');
    const fetchBytes = (url: string): Promise<ArrayBuffer> =>
      url === first.url ? Promise.reject(new Error('404')) : Promise.resolve(new ArrayBuffer(8));
    const { fonts, loaded } = loadFontLibrary([first, second], onError, fetchBytes);
    await loaded;
    expect(fonts.faces).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(fonts.contentIdentity).toBeUndefined();
  });
});

it('does not certify a partial catalogue when loading resolves after one missing face', async () => {
  const [first, second] = FONT_FACE_SOURCES;
  if (first === undefined || second === undefined) throw new Error('empty catalogue');
  const onError = vi.fn();
  const { fonts, loaded } = loadFontLibrary([first, second], onError, (url) =>
    url === first.url ? readFile(url) : Promise.reject(new Error('missing face')),
  );
  await loaded;
  expect(fonts.faces).toHaveLength(1);
  expect(fonts.contentIdentity).toBeUndefined();
  expect(onError).toHaveBeenCalledOnce();
});

it('parses every bundled library face and records all five categories', async () => {
  const sources = FONT_FAMILIES.flatMap((entry) => entry.faces);
  const error = vi.fn();
  const { fonts, loaded } = loadFontLibrary(sources, error, readFile);
  await loaded;
  expect(error).not.toHaveBeenCalled();
  expect(fonts.faces).toHaveLength(sources.length);
  expect(new Set(FONT_FAMILIES.map((entry) => entry.category)).size).toBe(5);
});
