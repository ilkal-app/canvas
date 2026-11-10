import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { extractFace } from '@canvas/text';

import { LocalFontSource, type LocalFace } from './local-font-source.js';

// Acceptance map: the source consults the check after TTC extraction,
// skips refused faces, keeps its existing unavailable message, and still loads valid
// corpus faces by default.

const CORPUS = '../../../text/src/__fixtures__/format-corpus/';
const UNAVAILABLE = 'Unavailable: this family needs static TrueType or CFF outlines.';

type FontCheck =
  { readonly isReadable: true } | { readonly isReadable: false; readonly reason: string };

function corpus(filename: string): ArrayBuffer {
  return Uint8Array.from(readFileSync(new URL(`${CORPUS}${filename}`, import.meta.url))).buffer;
}

function localFace(
  family: string,
  style: string,
  bytes: ArrayBuffer,
  postscriptName?: string,
): LocalFace {
  return {
    family,
    style,
    ...(postscriptName === undefined ? {} : { postscriptName }),
    blob: () => Promise.resolve(new Blob([bytes])),
  };
}

describe('LocalFontSource check injection', () => {
  it('skips refused faces while loading accepted faces in priority order', async () => {
    const regular = corpus('corpus-sans-regular.ttf');
    const bold = corpus('corpus-sans-bold.ttf');
    const check = vi.fn((bytes: ArrayBuffer): Promise<FontCheck> =>
      Promise.resolve(
        Buffer.from(bytes).equals(Buffer.from(regular))
          ? { isReadable: false, reason: 'refused' }
          : { isReadable: true },
      ),
    );
    const source = new LocalFontSource(
      () =>
        Promise.resolve([
          localFace('Corpus', 'Regular', regular),
          localFace('Corpus', 'Bold', bold),
        ]),
      { check },
    );
    await source.list();
    const files = await source.load('Corpus');
    expect(files.map(({ face }) => face.weight)).toEqual([700]);
    expect(new Uint8Array(files[0]?.bytes ?? new ArrayBuffer(0))).toEqual(new Uint8Array(bold));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing unavailable message when every face is refused', async () => {
    const check = vi.fn(() =>
      Promise.resolve({ isReadable: false, reason: 'unsafe' } as FontCheck),
    );
    const source = new LocalFontSource(
      () => Promise.resolve([localFace('Corpus', 'Regular', corpus('corpus-sans-regular.ttf'))]),
      { check },
    );
    await source.list();
    await expect(source.load('Corpus')).rejects.toMatchObject({ message: UNAVAILABLE });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('checks the extracted TTC face file selected by PostScript name', async () => {
    const collection = corpus('corpus-sans.ttc');
    const check = vi.fn((bytes: ArrayBuffer) => {
      expect(bytes.byteLength).toBeGreaterThan(0);
      return Promise.resolve({ isReadable: true } as FontCheck);
    });
    const source = new LocalFontSource(
      () => Promise.resolve([localFace('Corpus', 'Bold', collection, 'CorpusSans-Bold')]),
      { check },
    );
    await source.list();
    const files = await source.load('Corpus');
    const checked = check.mock.calls[0]?.[0];
    if (checked === undefined) throw new Error('Missing checked face');
    expect(new Uint8Array(checked)).toEqual(extractFace(collection, 1));
    expect(new Uint8Array(files[0]?.bytes ?? new ArrayBuffer(0))).toEqual(
      extractFace(collection, 1),
    );
    expect(collection.byteLength).toBeGreaterThan(checked.byteLength);
  });

  it('defaults to the real check for static TTF, CFF and CFF2 corpus faces', async () => {
    const source = new LocalFontSource(() =>
      Promise.resolve([
        localFace('Corpus', 'Regular', corpus('corpus-sans-regular.ttf')),
        localFace('Corpus', 'Bold', corpus('corpus-sans-bold.cff.otf')),
        localFace('Corpus', 'Black', corpus('corpus-serif-regular.cff2.otf')),
      ]),
    );
    await source.list();
    const files = await source.load('Corpus');
    expect(files.map(({ face }) => face.weight)).toEqual([400, 700, 900]);
  });
});
