import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { layoutText } from './layout-text.js';
import type { TextAlign } from './text-layout.js';

// Ported from the prototype's `src/text/layout.test.ts`. With FakeGlyphMeasurer at fontSize 10
// a character is 6 wide, a line 12.5 tall, and its baseline at 9.25.
const S: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const BIG: TextStyle = { ...S, fontSize: 20 };
const RED: TextStyle = { ...S, color: [1, 0, 0, 1] };
const FACE_ID = '400|n|Fake';
const m = new FakeGlyphMeasurer();
const one = (text: string, style = S): StyleRun[] => [{ length: text.length, style }];
const lay = (text: string, maxWidth: number | null = null, align: TextAlign = 'left') =>
  layoutText(text, one(text), maxWidth, m, align);
const char = (codepoint: number): string => String.fromCodePoint(codepoint);

describe('layoutText', () => {
  it('lays out empty text as one empty line', () => {
    const l = lay('');
    expect(l.lines).toEqual([
      {
        start: 0,
        end: 0,
        isHard: true,
        x: 0,
        y: 0,
        height: 12.5,
        ascent: 9.25,
        descent: 3.25,
        baseline: 9.25,
        width: 0,
      },
    ]);
    expect(l.height).toBe(12.5);
    expect(l.width).toBe(0);
  });

  it('positions glyphs on one line', () => {
    const l = lay('ab');
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 6]);
    expect(l.glyphs[0]?.y).toBe(9.25);
    expect(l.width).toBe(12);
  });

  it('applies kerning', () => {
    const km = new FakeGlyphMeasurer(0.6, { AV: -0.1 });
    const l = layoutText('AV', one('AV'), null, km);
    expect(l.glyphs[1]?.x).toBe(5);
  });

  it('breaks on newline', () => {
    const l = lay('a\nb');
    expect(l.lines.map((x) => [x.start, x.end, x.isHard])).toEqual([
      [0, 1, true],
      [2, 3, true],
    ]);
    expect(l.glyphs[1]).toMatchObject({ codepoint: 0x62, line: 1, x: 0, y: 21.75 });
    expect(l.height).toBe(25);
  });

  it('wraps at the last space when maxWidth is set', () => {
    const l = lay('aaa bbb', 20);
    expect(l.lines.map((x) => [x.start, x.end, x.isHard])).toEqual([
      [0, 4, false],
      [4, 7, true],
    ]);
    expect(l.glyphs.find((g) => g.index === 4)).toMatchObject({ line: 1, x: 0 });
    expect(l.lines[0]?.width).toBe(24); // the trailing space hangs past maxWidth
  });

  it('breaks a long word by character', () => {
    const l = lay('aaaaa', 20);
    expect(l.lines.map((x) => [x.start, x.end, x.isHard])).toEqual([
      [0, 3, false],
      [3, 5, true],
    ]);
  });

  it('does not wrap when maxWidth is null', () => {
    expect(lay('aaa bbb aaa bbb', null).lines).toHaveLength(1);
  });

  it('treats a surrogate pair as one glyph', () => {
    const l = lay('a\u{1F600}b');
    expect(l.glyphs.map((g) => [char(g.codepoint).length, g.index])).toEqual([
      [1, 0],
      [2, 1],
      [1, 3],
    ]);
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 6, 12]);
  });

  it('never mutates its inputs', () => {
    const runs = Object.freeze([Object.freeze({ length: 7, style: Object.freeze({ ...S }) })]);
    expect(() => layoutText('aaa bbb', runs, 20, m, 'center')).not.toThrow();
    expect(runs).toEqual([{ length: 7, style: S }]);
  });

  it('rejects an empty run list, which the run invariant forbids', () => {
    expect(() => layoutText('a', [], null, m)).toThrow(RangeError);
  });
});

describe('mixed styles', () => {
  const ab: StyleRun[] = [
    { length: 1, style: S },
    { length: 1, style: BIG },
  ];

  it('records resolved runs and tags each glyph with its run', () => {
    const l = layoutText('ab', ab, null, m);
    expect(l.runs).toEqual([
      { faceId: FACE_ID, fontSize: 10, color: [0, 0, 0, 1] },
      { faceId: FACE_ID, fontSize: 20, color: [0, 0, 0, 1] },
    ]);
    expect(l.glyphs.map((g) => g.run)).toEqual([0, 1]);
  });

  it('scales advances per run and shares one baseline per line', () => {
    const l = layoutText('ab', ab, null, m);
    expect(l.glyphs.map((g) => [g.x, g.advance])).toEqual([
      [0, 6],
      [6, 12],
    ]);
    expect(l.width).toBe(18);
    expect(l.lines[0]).toMatchObject({
      y: 0,
      ascent: 18.5,
      descent: 6.5,
      height: 25,
      baseline: 18.5,
    });
    expect(l.glyphs.map((g) => g.y)).toEqual([18.5, 18.5]);
    expect(l.height).toBe(25);
  });

  it('stacks lines of different heights', () => {
    const l = layoutText(
      'a\nb',
      [
        { length: 2, style: S },
        { length: 1, style: BIG },
      ],
      null,
      m,
    );
    expect(l.lines.map((x) => [x.y, x.height, x.baseline])).toEqual([
      [0, 12.5, 9.25],
      [12.5, 25, 31],
    ]);
    expect(l.height).toBe(37.5);
    expect(l.glyphs[1]?.y).toBe(31);
  });

  it('kerns across a colour-only boundary but not across a size boundary', () => {
    const km = new FakeGlyphMeasurer(0.6, { AV: -0.1 });
    const colour = layoutText(
      'AV',
      [
        { length: 1, style: S },
        { length: 1, style: RED },
      ],
      null,
      km,
    );
    expect(colour.glyphs[1]?.x).toBe(5);
    const size = layoutText(
      'AV',
      [
        { length: 1, style: S },
        { length: 1, style: BIG },
      ],
      null,
      km,
    );
    expect(size.glyphs[1]?.x).toBe(6);
  });

  it('sizes an empty line from the style of its newline', () => {
    const runs: StyleRun[] = [
      { length: 2, style: S },
      { length: 1, style: BIG },
      { length: 1, style: S },
    ];
    const l = layoutText('a\n\nb', runs, null, m);
    expect(l.lines.map((x) => [x.y, x.height])).toEqual([
      [0, 12.5],
      [12.5, 25],
      [37.5, 12.5],
    ]);
  });

  it('sizes a trailing empty line from the last run', () => {
    const runs: StyleRun[] = [
      { length: 1, style: S },
      { length: 1, style: BIG },
    ];
    expect(layoutText('a\n', runs, null, m).lines.map((x) => x.height)).toEqual([12.5, 25]);
  });

  it('wraps using per-run advances', () => {
    // "aa " = 18 at size 10, then "bb" = 24 at size 20: does not fit in 30, so it wraps at the space.
    const runs: StyleRun[] = [
      { length: 3, style: S },
      { length: 2, style: BIG },
    ];
    const l = layoutText('aa bb', runs, 30, m);
    expect(l.lines.map((x) => [x.start, x.end, x.isHard])).toEqual([
      [0, 3, false],
      [3, 5, true],
    ]);
    expect(l.lines.map((x) => x.height)).toEqual([12.5, 25]);
  });
});

describe('aligned text', () => {
  it('left alignment is the default and leaves every line at x = 0', () => {
    expect(lay('aaa bbb', 20).lines.map((l) => l.x)).toEqual([0, 0]);
  });

  it('centres a single line inside maxWidth', () => {
    const l = lay('ab', 100, 'center');
    expect(l.lines[0]).toMatchObject({ x: 44, width: 12 });
    expect(l.glyphs.map((g) => g.x)).toEqual([44, 50]);
    expect(l.width).toBe(12);
  });

  it('centres each wrapped line on its visible width, ignoring the hanging wrap space', () => {
    // "aaa " wraps before "bbbbb": line 0 is 24 wide with a trailing space (18 visible), line 1 is 30.
    const l = lay('aaa bbbbb', 40, 'center');
    expect(l.lines.map((x) => [x.start, x.end, x.isHard])).toEqual([
      [0, 4, false],
      [4, 9, true],
    ]);
    expect(l.lines.map((x) => x.x)).toEqual([11, 5]);
    expect(l.glyphs[0]?.x).toBe(11);
    expect(l.glyphs.find((g) => g.index === 4)?.x).toBe(5);
  });

  it('keeps trailing spaces on a hard line (the user typed them)', () => {
    expect(lay('ab ', 100, 'center').lines[0]?.x).toBe(41); // (100 - 18) / 2
  });

  it('centres within the widest line when there is no maxWidth', () => {
    const l = lay('aaaa\nbb', null, 'center');
    expect(l.lines.map((x) => x.x)).toEqual([0, 6]);
    expect(l.width).toBe(24);
  });

  it('clamps an overlong line to x = 0', () => {
    expect(lay('ab', 4, 'center').lines.map((x) => x.x)).toEqual([0, 0]);
  });

  it('centres the line of empty text', () => {
    expect(lay('', 100, 'center').lines[0]?.x).toBe(50);
  });

  it('right-aligns each line on its visible width', () => {
    const l = lay('aaa bbbbb', 40, 'right');
    expect(l.lines.map((x) => x.x)).toEqual([22, 10]);
    expect(lay('aaaa\nbb', null, 'right').lines.map((x) => x.x)).toEqual([0, 12]);
  });

  it('treats a wrapped line of only spaces as having no visible width', () => {
    // Two leading spaces fill the first line, so "b" wraps after them.
    const l = lay('  b', 6, 'right');
    expect(l.lines.map((x) => [x.start, x.end, x.isHard])).toEqual([
      [0, 2, false],
      [2, 3, true],
    ]);
    expect(l.lines.map((x) => x.x)).toEqual([6, 0]);
  });
});
