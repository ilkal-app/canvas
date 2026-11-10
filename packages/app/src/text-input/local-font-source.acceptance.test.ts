import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { parseFont } from '@canvas/engine';
import { extractFace } from '@canvas/text';

import * as localFontSource from './local-font-source.js';
import { LocalFontSource, type LocalFace, type LocalFontFile } from './local-font-source.js';

// Acceptance map: TTC extraction preserves each face's metrics and input bytes; collection names
// select or reject faces, while a one-face collection needs no name. CFF/CFF2 and plain sfnt keep
// their bytes, and plain styles retain priority and deduplication. fvar and malformed faces are
// refused without losing valid siblings. The predicate distinguishes static outlines from
// collections, web formats and broken files. Enumeration reads no blobs, and loading never fetches.
// The export may still be absent; keep the acceptance file lintable test-first.
const { isStaticSfnt } = localFontSource as unknown as {
  isStaticSfnt: (bytes: ArrayBuffer) => boolean;
};

const CORPUS = '../../../text/src/__fixtures__/format-corpus/';
const UNAVAILABLE = 'Unavailable: this family needs static TrueType or CFF outlines.';

function corpus(file: string) {
  return readFileSync(new URL(`${CORPUS}${file}`, import.meta.url));
}

function sourceFor(faces: readonly LocalFace[]): LocalFontSource {
  return new LocalFontSource(() => Promise.resolve(faces));
}

function localFace(
  family: string,
  style: string,
  bytes: Buffer,
  postscriptName?: string,
): LocalFace {
  return {
    family,
    style,
    ...(postscriptName === undefined ? {} : { postscriptName }),
    blob: () => Promise.resolve(new Blob([Uint8Array.from(bytes)])),
  };
}

function requiredBytes(files: readonly LocalFontFile[], index: number): ArrayBuffer {
  const bytes = files[index]?.bytes;
  if (bytes === undefined) throw new Error(`Missing installed face ${String(index)}`);
  return bytes;
}

function renameTable(bytes: Buffer, directoryOffset: number, from: string, to: string): Buffer {
  const changed = Buffer.from(bytes);
  const count = changed.readUInt16BE(directoryOffset + 4);
  for (let index = 0; index < count; index += 1) {
    const offset = directoryOffset + 12 + index * 16;
    if (changed.toString('ascii', offset, offset + 4) === from) {
      changed.write(to, offset, 'ascii');
      return changed;
    }
  }
  throw new Error(`Table ${from} is absent from fixture`);
}

describe('local font format acceptance', () => {
  it('matches both TTC faces by PostScript name and installs exact extracted files with the original metrics', async () => {
    const collection = corpus('corpus-sans.ttc');
    const original = Buffer.from(collection);
    const source = sourceFor([
      localFace('Corpus Sans', 'Regular', collection, 'CorpusSans-Regular'),
      localFace('Corpus Sans', 'Bold', collection, 'CorpusSans-Bold'),
    ]);
    await source.list();

    const files = await source.load('Corpus Sans');
    expect(files.map(({ face }) => face)).toEqual([
      { family: 'Corpus Sans', weight: 400, isItalic: false },
      { family: 'Corpus Sans', weight: 700, isItalic: false },
    ]);
    for (const [index, filename] of ['corpus-sans-regular.ttf', 'corpus-sans-bold.ttf'].entries()) {
      const installed = files[index]?.bytes;
      expect(installed).toBeDefined();
      if (installed === undefined) throw new Error(`Missing installed face ${String(index)}`);
      expect(new Uint8Array(installed)).toEqual(extractFace(collection, index));
      const actual = parseFont(installed);
      const reference = parseFont(corpus(filename));
      expect([actual.unitsPerEm, actual.ascent, actual.descent]).toEqual([
        reference.unitsPerEm,
        reference.ascent,
        reference.descent,
      ]);
      expect(actual.characterMap()).toEqual(reference.characterMap());
      expect(actual.characterMap().map(([, glyphId]) => actual.advanceOf(glyphId))).toEqual(
        reference.characterMap().map(([, glyphId]) => reference.advanceOf(glyphId)),
      );
    }
    expect(collection).toEqual(original);
  });

  it('skips unmatched and unnamed faces of a multi-face collection', async () => {
    const collection = corpus('corpus-sans.ttc');
    const source = sourceFor([
      localFace('Corpus Sans', 'Regular', collection, 'Not-A-Face'),
      localFace('Corpus Sans', 'Medium', collection),
      localFace('Corpus Sans', 'Bold', collection, 'CorpusSans-Bold'),
    ]);
    await source.list();
    const files = await source.load('Corpus Sans');
    expect(files).toHaveLength(1);
    expect(files[0]?.face.weight).toBe(700);
    expect(new Uint8Array(requiredBytes(files, 0))).toEqual(extractFace(collection, 1));
  });

  it('reports the exact unavailable message when no collection face matches', async () => {
    const collection = corpus('corpus-sans.ttc');
    const source = sourceFor([
      localFace('Corpus Sans', 'Regular', collection),
      localFace('Corpus Sans', 'Bold', collection, 'Not-A-Face'),
    ]);
    await source.list();
    await expect(source.load('Corpus Sans')).rejects.toMatchObject({ message: UNAVAILABLE });
  });

  it('loads face zero of a one-face collection without a PostScript name', async () => {
    const collection = Buffer.from(corpus('corpus-sans.ttc'));
    collection.writeUInt32BE(1, 8); // Keep the first face offset; later bytes are unreferenced.
    const original = Buffer.from(collection);
    const source = sourceFor([localFace('One Face', 'Regular', collection)]);
    await source.list();
    const files = await source.load('One Face');
    expect(files).toHaveLength(1);
    expect(new Uint8Array(requiredBytes(files, 0))).toEqual(extractFace(collection, 0));
    expect(collection).toEqual(original);
  });

  it.each(['cff.otf', 'cff2.otf'])(
    'loads static %s bytes unchanged and rejects fvar',
    async (extension) => {
      const bytes = corpus(`corpus-sans-regular.${extension}`);
      const original = Buffer.from(bytes);
      const source = sourceFor([localFace('Static CFF', 'Regular', bytes)]);
      await source.list();
      const files = await source.load('Static CFF');
      expect(files).toHaveLength(1);
      expect(new Uint8Array(requiredBytes(files, 0))).toEqual(Uint8Array.from(bytes));
      expect(() => parseFont(files[0]?.bytes ?? new ArrayBuffer(0))).not.toThrow();
      expect(bytes).toEqual(original);

      const variable = renameTable(bytes, 0, 'name', 'fvar');
      const rejected = sourceFor([localFace('Variable CFF', 'Regular', variable)]);
      await rejected.list();
      await expect(rejected.load('Variable CFF')).rejects.toMatchObject({ message: UNAVAILABLE });
    },
  );

  it('keeps plain sfnt bytes and prefers Regular when styles deduplicate to weight 400', async () => {
    const book = corpus('corpus-serif-regular.ttf');
    const regular = corpus('corpus-sans-regular.ttf');
    const source = sourceFor([
      localFace('Plain', 'Book', book),
      localFace('Plain', 'Regular', regular),
      localFace('Plain', 'Bold Italic', corpus('corpus-sans-bold.ttf')),
    ]);
    await source.list();
    const files = await source.load('Plain');
    expect(files.map(({ face }) => [face.weight, face.isItalic])).toEqual([
      [400, false],
      [700, true],
    ]);
    expect(new Uint8Array(requiredBytes(files, 0))).toEqual(Uint8Array.from(regular));
    expect(new Uint8Array(requiredBytes(files, 1))).toEqual(
      Uint8Array.from(corpus('corpus-sans-bold.ttf')),
    );
  });

  it('rejects fvar in an extracted collection face and skips a malformed collection', async () => {
    const collection = corpus('corpus-sans.ttc');
    const firstFaceOffset = collection.readUInt32BE(12);
    const variable = renameTable(collection, firstFaceOffset, 'name', 'fvar');
    variable.writeUInt32BE(1, 8); // A single-face collection needs no name match.
    const malformed = Buffer.from(collection);
    malformed.writeUInt32BE(malformed.length, 12);
    const staticFace = corpus('corpus-sans-regular.ttf');
    const source = sourceFor([
      localFace('Mixed', 'Regular', malformed, 'CorpusSans-Regular'),
      localFace('Mixed', 'Medium', variable),
      localFace('Mixed', 'Bold', staticFace),
    ]);
    await source.list();
    const files = await source.load('Mixed');
    expect(files).toHaveLength(1);
    expect(files[0]?.face.weight).toBe(700);
    expect(new Uint8Array(requiredBytes(files, 0))).toEqual(Uint8Array.from(staticFace));

    const unsupported = sourceFor([localFace('Unsupported', 'Regular', variable)]);
    await unsupported.list();
    await expect(unsupported.load('Unsupported')).rejects.toMatchObject({ message: UNAVAILABLE });

    const brokenOnly = sourceFor([localFace('Broken', 'Regular', malformed)]);
    await brokenOnly.list();
    await expect(brokenOnly.load('Broken')).rejects.toMatchObject({ message: UNAVAILABLE });
  });

  it('recognizes static sfnt outlines and rejects collections, web formats and broken directories', () => {
    for (const extension of ['ttf', 'cff.otf', 'cff2.otf']) {
      expect(isStaticSfnt(Uint8Array.from(corpus(`corpus-sans-regular.${extension}`)).buffer)).toBe(
        true,
      );
    }
    for (const filename of [
      'corpus-sans.ttc',
      'corpus-sans-regular.woff',
      'corpus-sans-regular.woff2',
    ]) {
      const bytes = corpus(filename);
      expect(isStaticSfnt(Uint8Array.from(bytes).buffer)).toBe(false);
    }
    expect(isStaticSfnt(new ArrayBuffer(11))).toBe(false);
    const truncated = Buffer.from(corpus('corpus-sans-regular.ttf').subarray(0, 12));
    expect(isStaticSfnt(Uint8Array.from(truncated).buffer)).toBe(false);
    const withoutOutline = renameTable(corpus('corpus-sans-regular.ttf'), 0, 'glyf', 'VOID');
    expect(isStaticSfnt(Uint8Array.from(withoutOutline).buffer)).toBe(false);
    const variable = renameTable(corpus('corpus-sans-regular.ttf'), 0, 'name', 'fvar');
    expect(isStaticSfnt(Uint8Array.from(variable).buffer)).toBe(false);
    for (const extension of ['cff.otf', 'cff2.otf']) {
      const cffVariable = renameTable(
        corpus(`corpus-sans-regular.${extension}`),
        0,
        'name',
        'fvar',
      );
      expect(isStaticSfnt(Uint8Array.from(cffVariable).buffer)).toBe(false);
    }
    const trueSfnt = Buffer.from(corpus('corpus-sans-regular.ttf'));
    trueSfnt.write('true', 0, 'ascii');
    expect(isStaticSfnt(Uint8Array.from(trueSfnt).buffer)).toBe(true);
  });

  it('reads blobs only on load and makes no fetch request', async () => {
    const blob = vi.fn(() =>
      Promise.resolve(new Blob([Uint8Array.from(corpus('corpus-sans-regular.cff.otf'))])),
    );
    const query = vi.fn(() => Promise.resolve([{ family: 'Private', style: 'Regular', blob }]));
    const fetch = vi.spyOn(globalThis, 'fetch');
    const source = new LocalFontSource(query);
    expect(query).not.toHaveBeenCalled();
    expect(blob).not.toHaveBeenCalled();
    expect(await source.list()).toEqual(['Private']);
    expect(blob).not.toHaveBeenCalled();
    await source.load('Private');
    expect(blob).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
