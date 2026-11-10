// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  applyChromeFonts,
  loadChromeFonts,
  NEUTRAL_CHROME_FONTS,
  type ChromeFontFaceFactory,
  type ChromeFontSet,
} from './chrome-fonts.js';

/**
 * A stand-in for the page's `FontFace` and `document.fonts`, recording what was added.
 *
 * @returns What was added, the set and the face factory.
 */
function fakeFonts() {
  const added: { family: string; source: string; descriptors: FontFaceDescriptors }[] = [];
  const loading: string[] = [];
  const fontSet = {
    add(face: FontFace) {
      added.push(face as unknown as (typeof added)[number]);
      return fontSet as unknown as FontFaceSet;
    },
  };
  const makeFace: ChromeFontFaceFactory = (family, source, descriptors) =>
    ({
      family,
      source,
      descriptors,
      load: () => {
        loading.push(`${family} ${descriptors.weight ?? ''}`);
        return Promise.reject(new Error('offline'));
      },
    }) as unknown as FontFace;
  return { added, loading, fontSet, makeFace };
}

describe("the shell's own chrome fonts", () => {
  it('are Geist regular and medium and Geist Mono regular and medium, nothing heavier', () => {
    expect(
      NEUTRAL_CHROME_FONTS.faces.map(({ family, weight }) => `${family} ${String(weight)}`),
    ).toEqual(['Geist 400', 'Geist 500', 'Geist Mono 400', 'Geist Mono 500']);
    expect(NEUTRAL_CHROME_FONTS.ui).toMatch(/^"Geist", system-ui/);
    expect(NEUTRAL_CHROME_FONTS.mono).toMatch(/^"Geist Mono", /);
    expect(NEUTRAL_CHROME_FONTS.fallback).toBeUndefined();
  });

  it('name no font that is not open', () => {
    expect(JSON.stringify(NEUTRAL_CHROME_FONTS)).not.toMatch(/Rand/);
  });

  it('come from files fetched by URL, never inlined', () => {
    for (const face of NEUTRAL_CHROME_FONTS.faces) {
      expect(face.url, face.family).toMatch(/\.woff2(?:\?no-inline)?$/);
      expect(face.url).not.toMatch(/^data:/);
    }
  });
});

describe('loadChromeFonts', () => {
  it('adds a set to the page once however many roots ask, with its stand-in', () => {
    const { added, fontSet, makeFace } = fakeFonts();
    const loaded = new WeakMap<Pick<FontFaceSet, 'add'>, WeakSet<ChromeFontSet>>();
    const branded: ChromeFontSet = {
      faces: [{ family: 'Brand', weight: 400, url: '/brand.woff2', isEager: true }],
      ui: '"Brand"',
      mono: 'monospace',
      fallback: { family: 'Brand fallback', source: 'local("Arial")', descriptors: {} },
    };
    loadChromeFonts(NEUTRAL_CHROME_FONTS, fontSet, makeFace, loaded);
    loadChromeFonts(NEUTRAL_CHROME_FONTS, fontSet, makeFace, loaded);
    expect(added).toHaveLength(NEUTRAL_CHROME_FONTS.faces.length);
    expect(added[0]).toMatchObject({
      family: 'Geist',
      source: `url("${NEUTRAL_CHROME_FONTS.faces[0]?.url ?? ''}") format("woff2")`,
      descriptors: { weight: '400', display: 'fallback' },
    });
    loadChromeFonts(branded, fontSet, makeFace, loaded);
    loadChromeFonts(branded, fontSet, makeFace, loaded);
    expect(added.slice(NEUTRAL_CHROME_FONTS.faces.length).map(({ family }) => family)).toEqual([
      'Brand',
      'Brand fallback',
    ]);
  });

  it('fetches the eager faces at once, as a preload would, and the others when text needs them', () => {
    const { loading, fontSet, makeFace } = fakeFonts();
    expect(() => {
      loadChromeFonts(NEUTRAL_CHROME_FONTS, fontSet, makeFace, new WeakMap());
    }).not.toThrow();
    expect(loading).toEqual(['Geist 400', 'Geist 500']);
  });

  it("loads the shell's own set when given none", () => {
    const { added, fontSet, makeFace } = fakeFonts();
    loadChromeFonts(undefined, fontSet, makeFace, new WeakMap());
    expect(added.map(({ family }) => family)).toEqual(
      NEUTRAL_CHROME_FONTS.faces.map(({ family }) => family),
    );
  });

  it('does nothing where the page has no font loading (a test environment, a server)', () => {
    expect(() => {
      loadChromeFonts(NEUTRAL_CHROME_FONTS, undefined, undefined);
    }).not.toThrow();
  });
});

describe('applyChromeFonts', () => {
  it("sets the set's two stacks on the themed element", () => {
    const element = document.createElement('div');
    applyChromeFonts(element, NEUTRAL_CHROME_FONTS);
    expect(element.style.getPropertyValue('--font-ui')).toBe(NEUTRAL_CHROME_FONTS.ui);
    expect(element.style.getPropertyValue('--font-mono')).toBe(NEUTRAL_CHROME_FONTS.mono);
  });
});
