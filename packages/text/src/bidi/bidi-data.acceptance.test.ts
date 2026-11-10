import { describe, expect, it } from 'vitest';

import {
  bidiClassOf as publicBidiClassOf,
  mirroredCodepointOf as publicMirroredCodepointOf,
  pairedBracketOf as publicPairedBracketOf,
  type BidiClass,
} from '../index.js';

import { ucdText } from './__fixtures__/bidi-conformance.js';
import { bidiClassOf, mirroredCodepointOf, pairedBracketOf } from './bidi-class.js';

describe('Unicode 17 bidi property data', () => {
  it('exports the property lookups from the package root', () => {
    const expected: BidiClass = 'L';
    expect(publicBidiClassOf(0x61)).toBe(expected);
    expect(publicPairedBracketOf(0x28)).toEqual({ pair: 0x29, type: 'o' });
    expect(publicMirroredCodepointOf(0x28)).toBe(0x29);
  });

  it('matches representative explicit ranges in DerivedBidiClass.txt', () => {
    const rows = ucdText('DerivedBidiClass').split(/\r?\n/u);
    const samples = [0x0041, 0x05d0, 0x1ee00, 0x2060, 0xfdd0];
    for (const codepoint of samples) {
      const entry = rows.find((row) => {
        const match = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([A-Z]+)/u.exec(row);
        if (match === null) return false;
        const first = Number.parseInt(match[1] ?? '', 16);
        const last = Number.parseInt(match[2] ?? match[1] ?? '', 16);
        return first <= codepoint && codepoint <= last;
      });
      const expected = /;\s*([A-Z]+)/u.exec(entry ?? '')?.[1];
      expect(expected, `fixture has U+${codepoint.toString(16)}`).toBeDefined();
      expect(bidiClassOf(codepoint)).toBe(expected);
    }
  });

  it('uses @missing defaults for unassigned RTL, AL, ET, and ordinary codepoints', () => {
    expect(ucdText('DerivedBidiClass')).toContain('@missing: 0590..05FF; Right_To_Left');
    expect(bidiClassOf(0x05ff)).toBe('R');
    expect(bidiClassOf(0x0750)).toBe('AL');
    expect(bidiClassOf(0x20cf)).toBe('ET');
    expect(bidiClassOf(0x0378)).toBe('L');
    expect(bidiClassOf(0xfdd0)).toBe('BN');
    expect(bidiClassOf(0x2060)).toBe('BN');
    expect(bidiClassOf(0xffff)).toBe('BN');
  });

  it('looks up paired brackets, including canonical-equivalent angle brackets', () => {
    expect(pairedBracketOf(0x28)).toEqual({ pair: 0x29, type: 'o' });
    expect(pairedBracketOf(0x29)).toEqual({ pair: 0x28, type: 'c' });
    expect(pairedBracketOf(0x3008)).toEqual({ pair: 0x3009, type: 'o' });
    expect(pairedBracketOf(0x3009)).toEqual({ pair: 0x3008, type: 'c' });
    expect(pairedBracketOf(0x2329)).toEqual({ pair: 0x232a, type: 'o' });
    expect(pairedBracketOf(0x232a)).toEqual({ pair: 0x2329, type: 'c' });
    expect(pairedBracketOf(0x61)).toBeUndefined();
  });

  it('looks up mirroring glyphs and leaves unmapped characters undefined', () => {
    expect(mirroredCodepointOf(0x28)).toBe(0x29);
    expect(mirroredCodepointOf(0xab)).toBe(0xbb);
    expect(mirroredCodepointOf(0x61)).toBeUndefined();
  });
});
