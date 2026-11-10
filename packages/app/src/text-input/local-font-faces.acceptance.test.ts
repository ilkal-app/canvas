import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FontLibrary, fontFaceId } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';
import { LocalFontSource, type LocalFace } from './local-font-source.js';

const regular = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
const bold = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Bold.ttf', import.meta.url),
);

/**
 * Supplies one browser-local face without a network request.
 *
 * @param style - Browser style name.
 * @param bytes - Font bytes.
 * @param postscriptName - Optional browser-provided name.
 * @returns A local face backed by an in-memory blob.
 */
function face(style: string, bytes: Buffer, postscriptName?: string): LocalFace {
  return {
    family: 'Private Sans',
    style,
    ...(postscriptName === undefined ? {} : { postscriptName }),
    blob: () => Promise.resolve(new Blob([Uint8Array.from(bytes)])),
  };
}

describe('local named faces', () => {
  it('keeps plain weight variants and every distinct non-plain face', async () => {
    const source = new LocalFontSource(() =>
      Promise.resolve([
        face('Regular', regular, 'Browser-Regular'),
        face('Bold', bold, 'Browser-Bold'),
        face('Condensed Bold', bold, 'PrivateSans-CondensedBold'),
        face('Condensed Bold', bold, 'PrivateSans-CondensedBold'),
        face('Display', bold, 'PrivateSans-Display'),
      ]),
    );
    await source.list();
    const files = await source.load('Private Sans');
    expect(files.map(({ face: key }) => key)).toEqual([
      { family: 'Private Sans', weight: 400, isItalic: false },
      { family: 'Private Sans', weight: 700, isItalic: false },
      {
        family: 'Private Sans',
        weight: 700,
        isItalic: false,
        postScriptName: 'PrivateSans-CondensedBold',
      },
      {
        family: 'Private Sans',
        weight: 400,
        isItalic: false,
        postScriptName: 'PrivateSans-Display',
      },
    ]);
    const library = new FontLibrary();
    const demand = new DemandFonts(library, []);
    demand.installLocal('Private Sans', files);
    expect(demand.status('Private Sans')).toBe('ready');
    for (const file of files) expect(library.get(fontFaceId(file.face))).toBeDefined();
  });

  it('finds a non-plain name in the file when browser metadata has none', async () => {
    const source = new LocalFontSource(() =>
      Promise.resolve([face('Light Italic', regular), face('Condensed Bold', bold)]),
    );
    await source.list();
    expect((await source.load('Private Sans')).map(({ face: key }) => key)).toEqual([
      { family: 'Private Sans', weight: 300, isItalic: true },
      {
        family: 'Private Sans',
        weight: 700,
        isItalic: false,
        postScriptName: 'LiberationSans-Bold',
      },
    ]);
  });
});
