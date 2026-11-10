import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import { fontFaceId, fontFaceOf, resolveFontFace, type FontFaceKey } from './font-face.js';

type NamedFace = FontFaceKey & { readonly postScriptName?: string };
const plain: NamedFace = { family: 'Inter', weight: 700, isItalic: false };
const condensed: NamedFace = { ...plain, postScriptName: 'Inter-CondensedBold' };
const display: NamedFace = { ...plain, postScriptName: 'Inter-DisplayBold' };

describe('named font faces', () => {
  it('keeps old ids and separates names with a length-delimited segment', () => {
    expect(fontFaceId(plain)).toBe('700|n|Inter');
    // A named slant is in capitals (fixed after the acceptance commit): a
    // nameless family '#19:…|Inter' would otherwise collide with a named face.
    expect(fontFaceId(condensed)).toBe('700|N|19:Inter-CondensedBold|Inter');
    expect(new Set([plain, condensed, display].map(fontFaceId)).size).toBe(3);
    expect(fontFaceId({ ...condensed, isItalic: true })).toBe('700|I|19:Inter-CondensedBold|Inter');
    expect(fontFaceId({ family: 'b', weight: 400, isItalic: false, postScriptName: 'a' })).not.toBe(
      fontFaceId({ family: '1:a|b', weight: 400, isItalic: false }),
    );
  });

  it('carries a style name only when present', () => {
    const style: TextStyle = {
      fontFamily: 'Inter',
      fontSize: 20,
      color: 'ink',
      weight: 700,
      italic: false,
    };
    expect(fontFaceOf(style)).toEqual(plain);
    expect(fontFaceOf({ ...style, postScriptName: 'Inter-CondensedBold' })).toEqual(condensed);
  });

  it('picks the named face before weight and slant, only inside the requested family', () => {
    const otherWeight: NamedFace = { ...condensed, weight: 400, isItalic: true };
    expect(resolveFontFace([plain, otherWeight], condensed)).toBe(otherWeight);
    expect(resolveFontFace([plain, { ...condensed, family: 'Other' }], condensed)).toBe(plain);
  });

  it('uses plain faces for missing or absent names, then named faces if no plain face exists', () => {
    const regular: NamedFace = { ...plain, weight: 400 };
    expect(resolveFontFace([condensed, regular], plain)).toBe(regular);
    expect(resolveFontFace([condensed, regular], { ...plain, postScriptName: 'Absent' })).toBe(
      regular,
    );
    expect(resolveFontFace([condensed, display], plain)).toBe(condensed);
  });
});
