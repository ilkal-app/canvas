import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';
import { lineExtent } from '@canvas/text';
import type { TextAlign } from '@canvas/text';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { caretRect, hitTest, indexAtLine, lineAtY, lineEndIndex, lineOf } from './caret.js';

// Ported from the prototype's `src/text/layout.test.ts` ("caret helpers", and the caret and hit
// cases of "mixed styles" and "centred text").
const S: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const BIG: TextStyle = { ...S, fontSize: 20 };
const FACE_ID = '400|n|Fake';
const m = new FakeGlyphMeasurer();
const one = (text: string): StyleRun[] => [{ length: text.length, style: S }];
const lay = (text: string, maxWidth: number | null = null, align: TextAlign = 'left') =>
  layoutText(text, one(text), maxWidth, m, align);

describe('caret helpers', () => {
  it('hit-tests past a surrogate pair to the index after it', () => {
    expect(hitTest(lay('a\u{1F600}b'), { x: 10, y: 3 })).toBe(3);
  });

  it('lineOf follows hard-break and wrap semantics', () => {
    const hard = lay('a\nb');
    expect([0, 1, 2, 3].map((i) => lineOf(hard, i))).toEqual([0, 0, 1, 1]);
    const wrapped = lay('aaa bbb', 20);
    expect([3, 4, 7].map((i) => lineOf(wrapped, i))).toEqual([0, 1, 1]);
    expect(lineOf(wrapped, 99)).toBe(1);
  });

  it('lineEndIndex places the caret before a trailing wrap space', () => {
    const wrapped = lay('aaa bbb', 20);
    expect(lineEndIndex(wrapped, 0)).toBe(3);
    expect(lineEndIndex(wrapped, 1)).toBe(7);
    expect(lineEndIndex(lay('a\nb'), 0)).toBe(1);
    expect(lineEndIndex(lay('aaaaa', 20), 0)).toBe(3);
  });

  it('caretRect spans the line box at the glyph or line end', () => {
    const l = lay('a\nb');
    expect(caretRect(l, 1)).toEqual({ x: 6, y: 0, height: 12.5 });
    expect(caretRect(l, 2)).toEqual({ x: 0, y: 12.5, height: 12.5 });
    expect(caretRect(l, 3)).toEqual({ x: 6, y: 12.5, height: 12.5 });
    expect(caretRect(lay(''), 0)).toEqual({ x: 0, y: 0, height: 12.5 });
  });

  it('hitTest picks the nearest caret slot', () => {
    const l = lay('ab');
    expect(hitTest(l, { x: 1, y: 3 })).toBe(0);
    expect(hitTest(l, { x: 7, y: 3 })).toBe(1);
    expect(hitTest(l, { x: 100, y: 3 })).toBe(2);
    expect(hitTest(l, { x: 100, y: -50 })).toBe(2);
    const two = lay('a\nb');
    expect(hitTest(two, { x: 100, y: 20 })).toBe(3);
    expect(hitTest(two, { x: 0, y: 500 })).toBe(2);
    expect(hitTest(lay('aaa bbb', 20), { x: 100, y: 3 })).toBe(3);
  });

  it('indexAtLine finds the slot nearest x on one line', () => {
    const l = lay('aaa\nbb');
    expect(indexAtLine(l, 1, 6)).toBe(5);
    expect(indexAtLine(l, 1, 12)).toBe(6);
    expect(indexAtLine(l, 0, 6)).toBe(1);
  });
});

describe('carets in mixed styles', () => {
  const ab: StyleRun[] = [
    { length: 1, style: S },
    { length: 1, style: BIG },
  ];
  const aOverB: StyleRun[] = [
    { length: 2, style: S },
    { length: 1, style: BIG },
  ];

  it('lineAtY and hitTest follow uneven line boxes', () => {
    const l = layoutText('a\nb', aOverB, null, m);
    expect([-5, 0, 12.4, 12.5, 37, 500].map((y) => lineAtY(l, y))).toEqual([0, 0, 0, 1, 1, 1]);
    expect(hitTest(l, { x: 100, y: 10 })).toBe(1);
    expect(hitTest(l, { x: 100, y: 20 })).toBe(3);
  });

  it('lineExtent includes half-leading', () => {
    expect(lineExtent(FACE_ID, 10, m)).toEqual({ ascent: 9.25, descent: 3.25 });
    expect(lineExtent(FACE_ID, 20, m)).toEqual({ ascent: 18.5, descent: 6.5 });
  });

  it('caretRect spans the line box, or the given extent around the baseline', () => {
    const l = layoutText('ab', ab, null, m);
    expect(caretRect(l, 0)).toEqual({ x: 0, y: 0, height: 25 });
    expect(caretRect(l, 0, lineExtent(FACE_ID, 10, m))).toEqual({ x: 0, y: 9.25, height: 12.5 });
    expect(caretRect(l, 2, lineExtent(FACE_ID, 20, m))).toEqual({ x: 18, y: 0, height: 25 });
  });
});

describe('carets in centred text', () => {
  it('centres the caret of an empty line', () => {
    expect(caretRect(lay('', 100, 'center'), 0)).toEqual({ x: 50, y: 0, height: 12.5 });
  });

  it('caretRect and hitTest follow the offset', () => {
    const l = lay('ab', 100, 'center');
    expect([0, 1, 2].map((i) => caretRect(l, i).x)).toEqual([44, 50, 56]);
    expect([0, 45, 48, 52, 54, 99].map((x) => hitTest(l, { x, y: 3 }))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});
