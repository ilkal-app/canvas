import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';

import { createMetricsMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

const fonts = loadBundledFaces().map(({ face, bytes }) =>
  createFontMetrics(face, parseFont(bytes)),
);
const style = (overrides: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: BUNDLED_FAMILY,
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
  ...overrides,
});
const cp = (character: string): number => character.codePointAt(0) ?? 0;

describe('createMetricsMeasurer', () => {
  const measurer = createMetricsMeasurer(fonts);

  it('resolves styles to the listed faces, falling back to the first', () => {
    expect(measurer.faceIdOf(style({ weight: 700, italic: true }))).toBe(`700|i|${BUNDLED_FAMILY}`);
    expect(measurer.faceIdOf(style({ fontFamily: 'Helvetica' }))).toBe(`400|n|${BUNDLED_FAMILY}`);
  });

  it('reads advances, kerning and line metrics in em from the tables', () => {
    const regular = `400|n|${BUNDLED_FAMILY}`;
    const bold = `700|n|${BUNDLED_FAMILY}`;
    expect(measurer.advance(regular, cp('A'))).toBe(0.6669921875);
    expect(measurer.advance(bold, cp('A'))).toBe(0.72216796875);
    expect(measurer.kerning(regular, cp('T'), cp('o'))).toBe(-0.11083984375);
    // With the face's underline and strikethrough metrics, from post and OS/2.
    expect(measurer.lineMetrics(bold)).toEqual({
      ascent: 0.9052734375,
      descent: 0.2119140625,
      underlinePosition: -0.0009765625,
      underlineThickness: 0.10498046875,
      strikeoutPosition: 0.2587890625,
      strikeoutThickness: 0.0498046875,
    });
  });

  it('rejects an empty font list and a face it has no metrics for', () => {
    expect(() => createMetricsMeasurer([])).toThrow(RangeError);
    expect(() => measurer.advance('400|n|Nope', 65)).toThrow(/Nope/);
    expect(() => measurer.lineMetrics('400|n|Nope')).toThrow(/Nope/);
  });

  it('lays out real text: kerned pairs, bold wider than regular, half-leading from the face', () => {
    const regular = layoutText('To', [{ length: 2, style: style() }], null, measurer);
    expect(regular.glyphs[1]?.x).toBeCloseTo((0.61083984375 - 0.11083984375) * 20, 10);
    const bold = layoutText(
      'Hello',
      [{ length: 5, style: style({ weight: 700 }) }],
      null,
      measurer,
    );
    const plain = layoutText('Hello', [{ length: 5, style: style() }], null, measurer);
    expect(bold.width).toBeGreaterThan(plain.width);
    expect(plain.height).toBe(25);
    const halfLeading = ((1.25 - (0.9052734375 + 0.2119140625)) * 20) / 2;
    expect(plain.lines[0]?.baseline).toBeCloseTo(0.9052734375 * 20 + halfLeading, 10);
  });
});
