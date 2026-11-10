import { describe, expect, it } from 'vitest';

import type { FontWeight, TextStyle } from '@canvas/schema';

import {
  fontFaceId,
  fontFaceOf,
  nearestWeights,
  resolveFontFace,
  type FontFaceKey,
} from './font-face.js';

const face = (family: string, weight: FontWeight, isItalic: boolean): FontFaceKey => ({
  family,
  weight,
  isItalic,
});

describe('fontFaceId', () => {
  it('distinguishes weight, slant and family, with the family last', () => {
    const ids = [
      face('Sans', 400, false),
      face('Sans', 700, false),
      face('Sans', 400, true),
      face('Serif', 400, false),
    ].map(fontFaceId);
    expect(new Set(ids).size).toBe(4);
    expect(fontFaceId(face('A|B', 700, true))).toBe('700|i|A|B');
  });
});

describe('fontFaceOf', () => {
  it('reads the family, weight and italic flag of a style', () => {
    const style: TextStyle = {
      fontFamily: 'Sans',
      fontSize: 12,
      color: [0, 0, 0, 1],
      weight: 700,
      italic: true,
    };
    expect(fontFaceOf(style)).toEqual(face('Sans', 700, true));
  });
});

describe('resolveFontFace', () => {
  const regular = face('Sans', 400, false);
  const bold = face('Sans', 700, false);
  const italic = face('Sans', 400, true);
  const other = face('Serif', 400, false);

  it('returns the exact face when it is loaded', () => {
    expect(resolveFontFace([regular, bold, italic], face('Sans', 700, false))).toBe(bold);
  });

  it('falls back within the family keeping the slant, as CSS does: bold italic to italic, then bold, then regular', () => {
    const wanted = face('Sans', 700, true);
    expect(resolveFontFace([regular, bold, italic], wanted)).toBe(italic);
    expect(resolveFontFace([regular, bold], wanted)).toBe(bold);
    expect(resolveFontFace([other, regular], wanted)).toBe(regular);
  });

  it('falls back to the first loaded face for an unknown family', () => {
    expect(resolveFontFace([other, regular], face('Helvetica', 400, false))).toBe(other);
  });

  it('uses any loaded face of the family when none matches weight or slant', () => {
    const boldItalic = face('Display', 700, true);
    expect(resolveFontFace([regular, boldItalic], face('Display', 400, false))).toBe(boldItalic);
  });

  it('returns undefined when no face is loaded', () => {
    expect(resolveFontFace([], regular)).toBeUndefined();
  });
});

describe('nearestWeights', () => {
  const all = [100, 300, 400, 500, 700, 900] as const;

  it('orders a weight from 400 to 500 up to 500, then down, then above 500', () => {
    expect(nearestWeights(400, all)).toEqual([400, 500, 300, 100, 700, 900]);
    expect(nearestWeights(450 as FontWeight, [400, 500, 600])).toEqual([500, 400, 600]);
  });

  it('orders a light weight down first, then up', () => {
    expect(nearestWeights(300, all)).toEqual([300, 100, 400, 500, 700, 900]);
    expect(nearestWeights(200, [400, 700])).toEqual([400, 700]);
  });

  it('orders a heavy weight up first, then down', () => {
    expect(nearestWeights(600, all)).toEqual([700, 900, 500, 400, 300, 100]);
    expect(nearestWeights(800, [400, 700])).toEqual([700, 400]);
  });
});

describe('resolveFontFace with the nine weights', () => {
  const regular = face('Sans', 400, false);
  const bold = face('Sans', 700, false);
  const medium = face('Sans', 500, false);
  const lightItalic = face('Sans', 300, true);

  it('draws a weight the family lacks with its nearest face, as CSS matches weights', () => {
    expect(resolveFontFace([regular, bold], face('Sans', 500, false))).toBe(regular);
    expect(resolveFontFace([regular, bold], face('Sans', 600, false))).toBe(bold);
    expect(resolveFontFace([regular, bold], face('Sans', 300, false))).toBe(regular);
    expect(resolveFontFace([regular, medium, bold], face('Sans', 600, false))).toBe(bold);
    expect(resolveFontFace([regular, medium, bold], face('Sans', 450 as FontWeight, false))).toBe(
      medium,
    );
  });

  it('keeps the slant before the weight, then falls back to upright', () => {
    expect(resolveFontFace([regular, bold, lightItalic], face('Sans', 600, true))).toBe(
      lightItalic,
    );
    expect(resolveFontFace([regular, bold], face('Sans', 600, true))).toBe(bold);
    // An upright face of the very weight does not win over the italic of another weight.
    expect(resolveFontFace([medium, face('Sans', 400, true)], face('Sans', 500, true))).toEqual(
      face('Sans', 400, true),
    );
  });
});
