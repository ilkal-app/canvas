// / acceptance (Claude): while a family is still loading, text set in it draws
// with a fallback chosen from the stored family name alone (its category hint, else the default
// sans), in the requested weight and slant; once the family's faces land the same request
// resolves to the exact face; and at no point does laying text out change the stored runs. The
// hint is deterministic and adds no metadata to the document ().
import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { fallbackFamily } from '@canvas/text';
import { fontFaceId, resolveFontFace, type FontFaceKey } from '@canvas/text';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';

import { FontLibrary } from './font-library.js';

/**
 * A library holding the four bundled default faces, which every page loads first.
 *
 * @returns The library.
 */
function defaultLibrary(): FontLibrary {
  const fonts = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
  return fonts;
}

/**
 * Adds a family's faces to a library using the bundled bytes under another family name, as a
 * curated family landing after startup does (the library keys faces by name, not by file).
 *
 * @param fonts - The library.
 * @param family - The family name to add under.
 * @param faces - Which weights and slants to add.
 * @throws {Error} When no bundled face has a wanted weight and slant (never, for 400/700).
 */
function landFamily(
  fonts: FontLibrary,
  family: string,
  faces: readonly { readonly weight: 400 | 700; readonly isItalic: boolean }[],
): void {
  const bundled = loadBundledFaces();
  for (const wanted of faces) {
    const source = bundled.find(
      ({ face }) => face.weight === wanted.weight && face.isItalic === wanted.isItalic,
    );
    if (source === undefined) throw new Error('no bundled face');
    fonts.addFace({ family, ...wanted }, source.bytes);
  }
}

/**
 * A text style in a family.
 *
 * @param fontFamily - The family.
 * @param weight - Regular or bold.
 * @param isItalic - Slant.
 * @returns The style.
 */
function styleIn(fontFamily: string, weight: 400 | 700 = 400, isItalic = false): TextStyle {
  return { fontFamily, fontSize: 24, color: [0, 0, 0, 1], weight, italic: isItalic };
}

/**
 * The bare key of a face (a library may carry extras on it).
 *
 * @param face - A face key.
 * @returns Family, weight, slant.
 */
function keyOf(face: FontFaceKey | undefined): FontFaceKey | undefined {
  return face === undefined
    ? undefined
    : { family: face.family, weight: face.weight, isItalic: face.isItalic };
}

describe('fallback while a family loads, exact face once it lands', () => {
  it('draws a curated family not yet loaded with the default sans in the requested weight and slant', () => {
    const fonts = defaultLibrary();
    expect(keyOf(fonts.resolve({ family: 'Lora', weight: 700, isItalic: true })?.face)).toEqual({
      family: 'Liberation Sans',
      weight: 700,
      isItalic: true,
    });
    expect(keyOf(fonts.resolve({ family: 'Caveat', weight: 400, isItalic: false })?.face)).toEqual({
      family: 'Liberation Sans',
      weight: 400,
      isItalic: false,
    });
  });

  it('swaps to the exact face once the family lands, with the stored runs untouched throughout', () => {
    const fonts = defaultLibrary();
    const runs: readonly StyleRun[] = Object.freeze([
      Object.freeze({ length: 6, style: Object.freeze(styleIn('Lora', 700, true)) }),
      Object.freeze({ length: 5, style: Object.freeze(styleIn('Liberation Sans')) }),
    ]);
    const snapshot = structuredClone(runs);
    const input = {
      objectId: 't',
      text: 'Serif  sans',
      runs,
      maxWidth: null,
      align: 'left',
    } as const;

    const loading = createLayoutJobRequest(input, fonts);
    expect(loading.runs).toBe(runs);
    expect(runs).toEqual(snapshot);
    const loadingFace = resolveFontFace(fonts.faces, {
      family: 'Lora',
      weight: 700,
      isItalic: true,
    });
    expect(loadingFace === undefined ? undefined : fontFaceId(loadingFace)).toBe(
      '700|i|Liberation Sans',
    );

    landFamily(fonts, 'Lora', [
      { weight: 400, isItalic: false },
      { weight: 700, isItalic: false },
      { weight: 400, isItalic: true },
      { weight: 700, isItalic: true },
    ]);
    const landed = createLayoutJobRequest(input, fonts);
    expect(landed.runs).toBe(runs);
    expect(runs).toEqual(snapshot);
    expect(keyOf(fonts.resolve({ family: 'Lora', weight: 700, isItalic: true })?.face)).toEqual({
      family: 'Lora',
      weight: 700,
      isItalic: true,
    });
    // The default face still leads: the worker's last-resort fallback stays the same face.
    expect(keyOf(fonts.faces[0])).toEqual({
      family: 'Liberation Sans',
      weight: 400,
      isItalic: false,
    });
  });

  it('degrades inside a family that ships fewer faces, never to another family', () => {
    const fonts = defaultLibrary();
    landFamily(fonts, 'Bebas Neue', [{ weight: 400, isItalic: false }]);
    expect(
      keyOf(fonts.resolve({ family: 'Bebas Neue', weight: 700, isItalic: true })?.face),
    ).toEqual({ family: 'Bebas Neue', weight: 400, isItalic: false });
  });
});

describe('fallback for a family this client cannot load', () => {
  it('is chosen from the stored name alone, deterministically, with unknown names as sans', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['Private Mono', 'JetBrains Mono'],
      ['Consolas', 'JetBrains Mono'],
      ['Comic Sans MS', 'Caveat'],
      ['Brush Script MT', 'Caveat'],
      ['Georgia', 'Lora'],
      ['Baskerville Old Face', 'Lora'],
      ['Impact', 'Oswald'],
      ['Helvetica Neue', 'Liberation Sans'],
      ['Zzyzx Private', 'Liberation Sans'],
      ['', 'Liberation Sans'],
    ];
    for (const [name, expected] of cases) {
      expect(fallbackFamily(name), name).toBe(expected);
      expect(fallbackFamily(name), `${name} (again)`).toBe(expected);
    }
    // Every fallback is a library family, so a collaborator with the library can always draw it.
    const libraryFallbacks = new Set([
      'JetBrains Mono',
      'Caveat',
      'Lora',
      'Oswald',
      'Liberation Sans',
    ]);
    for (const [name] of cases) expect(libraryFallbacks.has(fallbackFamily(name))).toBe(true);
  });

  it('draws a private family with its category fallback in the requested weight once that fallback is loaded', () => {
    const fonts = defaultLibrary();
    landFamily(fonts, 'JetBrains Mono', [
      { weight: 400, isItalic: false },
      { weight: 700, isItalic: false },
    ]);
    expect(
      keyOf(fonts.resolve({ family: 'Private Mono', weight: 700, isItalic: false })?.face),
    ).toEqual({ family: 'JetBrains Mono', weight: 700, isItalic: false });
    // An italic the fallback lacks degrades within the fallback family.
    expect(
      keyOf(fonts.resolve({ family: 'Private Mono', weight: 700, isItalic: true })?.face),
    ).toEqual({ family: 'JetBrains Mono', weight: 700, isItalic: false });
    // The unknown-name default keeps weight and slant in the default sans.
    expect(
      keyOf(fonts.resolve({ family: 'Zzyzx Private', weight: 700, isItalic: true })?.face),
    ).toEqual({ family: 'Liberation Sans', weight: 700, isItalic: true });
  });

  it('lays a private family out without rewriting its runs, and swaps to it once the owner’s bytes arrive', () => {
    const fonts = defaultLibrary();
    const runs: readonly StyleRun[] = [{ length: 5, style: styleIn('Private Mono', 700) }];
    const snapshot = structuredClone(runs);
    const input = { objectId: 't', text: 'Hello', runs, maxWidth: null, align: 'left' } as const;
    expect(createLayoutJobRequest(input, fonts).runs).toBe(runs);
    expect(runs).toEqual(snapshot);
    landFamily(fonts, 'Private Mono', [{ weight: 700, isItalic: false }]);
    expect(createLayoutJobRequest(input, fonts).runs).toBe(runs);
    expect(
      keyOf(fonts.resolve({ family: 'Private Mono', weight: 700, isItalic: false })?.face),
    ).toEqual({ family: 'Private Mono', weight: 700, isItalic: false });
    expect(runs).toEqual(snapshot);
  });
});
