import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { layoutText } from './layout-text.js';
import type { TextAlign } from './text-layout.js';

// With FakeGlyphMeasurer at fontSize 10 a character is 6 wide, an auto line 12.5 tall
// and the face 10 tall (ascent 8, descent 2).
const S: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const FACE_ID = '400|n|Fake';
const m = new FakeGlyphMeasurer();
const one = (text: string, style = S): StyleRun[] => [{ length: text.length, style }];

describe('letter-spacing and line-height', () => {
  const tracked = (letterSpacing: TextStyle['letterSpacing']): TextStyle => ({
    ...S,
    ...(letterSpacing === undefined ? {} : { letterSpacing }),
  });
  const spaced = (
    text: string,
    style: TextStyle,
    maxWidth: number | null = null,
    align: TextAlign = 'left',
  ) => layoutText(text, one(text, style), maxWidth, m, align);

  it('adds px spacing after each character and trims it at the line end', () => {
    const l = spaced('abc', tracked({ value: 2, unit: 'px' }));
    expect(l.glyphs.map((g) => [g.x, g.advance])).toEqual([
      [0, 6],
      [8, 6],
      [16, 6],
    ]);
    expect(l.width).toBe(22);
    expect(l.lines[0]?.width).toBe(22);
    expect(l.runs[0]).toEqual({
      faceId: FACE_ID,
      fontSize: 10,
      color: [0, 0, 0, 1],
      letterSpacing: 2,
    });
  });

  it('takes percent spacing of the run’s font size', () => {
    const l = spaced('abc', tracked({ value: 50, unit: 'percent' }));
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 11, 22]);
    expect(l.width).toBe(28);
  });

  it('allows negative spacing', () => {
    const l = spaced('ab', tracked({ value: -1, unit: 'px' }));
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 5]);
    expect(l.width).toBe(11);
  });

  it('centres tracked text on its trimmed width', () => {
    const l = spaced('ab', tracked({ value: 2, unit: 'px' }), 40, 'center');
    expect(l.lines[0]?.x).toBe(13);
  });

  it('fits a line whose last character ends at the wrap width, its spacing trimmed', () => {
    const l = spaced('ab', tracked({ value: 2, unit: 'px' }), 14);
    expect(l.lines).toHaveLength(1);
    expect(l.width).toBe(14);
  });

  it('wraps tracked text at the last space', () => {
    const l = spaced('ab cd', tracked({ value: 2, unit: 'px' }), 20);
    expect(l.lines.map((line) => [line.start, line.end, line.width])).toEqual([
      [0, 3, 22],
      [3, 5, 14],
    ]);
    expect(l.glyphs.filter((g) => g.line === 1).map((g) => g.x)).toEqual([0, 8]);
  });

  it('records no spacing for none, or a spacing of 0', () => {
    for (const style of [S, tracked({ value: 0, unit: 'percent' })]) {
      expect(spaced('ab', style).runs[0]).toEqual({
        faceId: FACE_ID,
        fontSize: 10,
        color: [0, 0, 0, 1],
      });
    }
  });

  it('sets a px line-height, the face centred in it', () => {
    const l = spaced('a', { ...S, lineHeight: { value: 30, unit: 'px' } });
    expect(l.lines[0]).toMatchObject({ height: 30, ascent: 18, descent: 12, baseline: 18 });
    expect(l.height).toBe(30);
    expect(l.runs[0]).toEqual({
      faceId: FACE_ID,
      fontSize: 10,
      color: [0, 0, 0, 1],
      lineHeight: 30,
    });
  });

  it('takes a percent line-height of the font size, and may be tighter than auto', () => {
    expect(
      spaced('a', { ...S, lineHeight: { value: 200, unit: 'percent' } }).lines[0],
    ).toMatchObject({
      height: 20,
      ascent: 13,
      descent: 7,
    });
    expect(spaced('a', { ...S, lineHeight: { value: 8, unit: 'px' } }).lines[0]).toMatchObject({
      height: 8,
      ascent: 7,
      descent: 1,
    });
  });

  it('keeps auto as 1.25 × the font size', () => {
    const l = spaced('a', { ...S, lineHeight: 'auto' });
    expect(l.lines[0]?.height).toBe(12.5);
    expect(l.runs[0]).toEqual({ faceId: FACE_ID, fontSize: 10, color: [0, 0, 0, 1] });
  });

  it('makes a line as tall as its tallest run', () => {
    const l = layoutText(
      'ab',
      [
        { length: 1, style: { ...S, lineHeight: { value: 30, unit: 'px' } } },
        { length: 1, style: S },
      ],
      null,
      m,
    );
    expect(l.lines[0]).toMatchObject({ height: 30, ascent: 18, descent: 12 });
  });

  it('sizes each line by its own runs, an empty line by its newline’s', () => {
    const l = layoutText(
      'a\n\nb',
      [
        { length: 3, style: { ...S, lineHeight: { value: 20, unit: 'px' } } },
        { length: 1, style: S },
      ],
      null,
      m,
    );
    expect(l.lines.map((line) => line.height)).toEqual([20, 20, 12.5]);
    expect(l.height).toBe(52.5);
  });
});
