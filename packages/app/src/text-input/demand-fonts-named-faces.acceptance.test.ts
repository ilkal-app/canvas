import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';

const regular = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
const bold = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Bold.ttf', import.meta.url),
);

/**
 * Copies bundled font bytes into the file shape accepted by local installation.
 *
 * @param family - The local family.
 * @param bytes - The face's bundled test bytes.
 * @param postScriptName - Its optional installed name.
 * @returns A file for `installLocal`.
 */
function file(family: string, bytes: Buffer, postScriptName?: string) {
  return {
    face: {
      family,
      weight: 400 as const,
      isItalic: false as const,
      ...(postScriptName === undefined ? {} : { postScriptName }),
    },
    bytes: Uint8Array.from(bytes).buffer,
  };
}

describe('DemandFonts named faces', () => {
  it('reports installed names in registration order, excluding the plain face', () => {
    const demand = new DemandFonts(new FontLibrary(), []);
    const named = demand as DemandFonts & { namedFaces(family: string): readonly string[] };
    expect(named.namedFaces('Unknown')).toEqual([]);
    demand.installLocal('Private Sans', [
      file('Private Sans', regular),
      file('Private Sans', bold, 'PrivateSans-Condensed'),
      file('Private Sans', bold, 'PrivateSans-Display'),
    ]);
    expect(named.namedFaces('Private Sans')).toEqual([
      'PrivateSans-Condensed',
      'PrivateSans-Display',
    ]);
    expect(named.namedFaces('Unknown')).toEqual([]);
  });

  it('lists a catalogue face only after its bytes are installed', async () => {
    const face = {
      family: 'Catalogue Sans',
      weight: 400 as const,
      isItalic: false as const,
      postScriptName: 'CatalogueSans-Display',
      url: '/display.ttf',
    };
    const demand = new DemandFonts(
      new FontLibrary(),
      [{ family: 'Catalogue Sans', category: 'sans', faces: [face] }],
      () => Promise.resolve(Uint8Array.from(bold).buffer),
    ) as DemandFonts & { namedFaces(family: string): readonly string[] };
    expect(demand.namedFaces('Catalogue Sans')).toEqual([]);
    expect(await demand.ensure('Catalogue Sans')).toBe(true);
    expect(demand.namedFaces('Catalogue Sans')).toEqual(['CatalogueSans-Display']);
  });
});
