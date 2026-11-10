/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import {
  createFontMetrics,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
} from '@canvas/text';
import type { LayoutGlyph, LayoutLine, TextLayout } from '@canvas/text';

import * as caret from './caret.js';

type Glyph = readonly [index: number, end: number, x: number, level: number, line?: number];
interface Span {
  line: number;
  left: number;
  right: number;
}
interface Placement {
  primary: number;
  secondary?: number;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture element is missing');
  return value;
}

const placement = Reflect.get(caret, 'caretPlacement') as
  ((layout: TextLayout, index: number) => Placement) | undefined;
const spans = Reflect.get(caret, 'selectionSpans') as
  ((layout: TextLayout, start: number, end: number) => Span[]) | undefined;

function layoutOf(text: string, specs: readonly Glyph[], ends = [text.length]): TextLayout {
  const lines: LayoutLine[] = ends.map((end, line) => {
    const start = line === 0 ? 0 : (ends[line - 1] ?? 0);
    const lineGlyphs = specs.filter((spec) => (spec[4] ?? 0) === line);
    const width = Math.max(0, ...lineGlyphs.map((spec) => spec[2] + 10));
    return {
      start,
      end,
      isHard: line === ends.length - 1,
      x: 0,
      y: line * 20,
      height: 20,
      ascent: 15,
      descent: 5,
      baseline: line * 20 + 15,
      width,
    };
  });
  const glyphs: LayoutGlyph[] = specs.map(([index, end, x, level, line = 0]) => ({
    codepoint: text.codePointAt(index) ?? 0,
    index,
    end,
    glyphId: end - index > 1 ? 1 : null,
    level,
    line,
    x,
    y: line * 20 + 15,
    advance: 10,
    run: 0,
  }));
  return {
    text,
    glyphs,
    lines,
    runs: [],
    width: Math.max(...lines.map((line) => line.width)),
    height: lines.length * 20,
  };
}

const rtl = layoutOf('אבג', [
  [0, 1, 20, 1],
  [1, 2, 10, 1],
  [2, 3, 0, 1],
]);
const mixed = layoutOf('aאבb', [
  [0, 1, 0, 0],
  [1, 2, 20, 1],
  [2, 3, 10, 1],
  [3, 4, 30, 0],
]);
const digits = layoutOf('אב12ג', [
  [0, 1, 40, 1],
  [1, 2, 30, 1],
  [2, 3, 10, 2],
  [3, 4, 20, 2],
  [4, 5, 0, 1],
]);
const wrapped = layoutOf(
  'aאב bגd',
  [
    [0, 1, 0, 0],
    [1, 2, 20, 1],
    [2, 3, 10, 1],
    [3, 4, 30, 0],
    [4, 5, 0, 0, 1],
    [5, 6, 10, 1, 1],
    [6, 7, 20, 0, 1],
  ],
  [4, 7],
);

function requirePlacement(layout: TextLayout, index: number): Placement {
  if (placement === undefined) throw new Error('caretPlacement must be exported from caret module');
  return placement(layout, index);
}

function requireSpans(layout: TextLayout, start: number, end: number): Span[] {
  if (spans === undefined) throw new Error('selectionSpans must be exported from caret module');
  return spans(layout, start, end);
}

describe('bidi caret geometry acceptance', () => {
  it('uses right leading edges on an all-RTL line and left trailing edge at its end', () => {
    expect([0, 1, 2, 3].map((index) => requirePlacement(rtl, index))).toEqual([
      { primary: 30 },
      { primary: 20 },
      { primary: 10 },
      { primary: 0 },
    ]);
    expect(caret.caretRect(rtl, 1)).toEqual({ x: 20, y: 0, height: 20 });
    expect(caret.caretRect(rtl, 2, { ascent: 4, descent: 3 })).toEqual({ x: 10, y: 11, height: 7 });
    expect(requireSpans(rtl, 0, 2)).toEqual([{ line: 0, left: 10, right: 30 }]);
  });

  it('splits carets at both direction boundaries and separates disjoint visual selection', () => {
    expect(requirePlacement(mixed, 1)).toEqual({ primary: 30, secondary: 10 });
    expect(requirePlacement(mixed, 3)).toEqual({ primary: 30, secondary: 10 });
    expect(caret.caretRect(mixed, 1).x).toBe(30);
    expect(requireSpans(mixed, 0, 2)).toEqual([
      { line: 0, left: 0, right: 10 },
      { line: 0, left: 20, right: 30 },
    ]);
    expect(requireSpans(mixed, 1, 3)).toEqual([{ line: 0, left: 10, right: 30 }]);
  });

  it('treats European digits inside RTL as a level-two visual island', () => {
    expect(requirePlacement(digits, 2)).toEqual({ primary: 10, secondary: 30 });
    expect(requirePlacement(digits, 4)).toEqual({ primary: 10, secondary: 30 });
    expect(requireSpans(digits, 1, 3)).toEqual([
      { line: 0, left: 10, right: 20 },
      { line: 0, left: 30, right: 40 },
    ]);
  });

  it('splits a shaped RTL cluster into grapheme boxes from the right', () => {
    const cluster = layoutOf('אב', [[0, 2, 0, 1]]);
    const glyph = cluster.glyphs[0];
    const shaped = {
      ...cluster,
      glyphs: glyph ? [{ ...glyph, advance: 20 }] : [],
      lines: [{ ...required(cluster.lines[0]), width: 20 }],
      width: 20,
    };
    expect([0, 1, 2].map((index) => requirePlacement(shaped, index).primary)).toEqual([20, 10, 0]);
    expect(caret.indexAtLine(shaped, 0, 19)).toBe(0);
    expect(caret.indexAtLine(shaped, 0, 11)).toBe(1);
    expect(requireSpans(shaped, 0, 1)).toEqual([{ line: 0, left: 10, right: 20 }]);
  });

  it('hit-tests visual halves, clamps outside the line, and uses the chosen line in hitTest', () => {
    expect([-1, 1, 9, 11, 19, 21, 29, 31].map((x) => caret.indexAtLine(rtl, 0, x))).toEqual([
      3, 3, 2, 2, 1, 1, 0, 0,
    ]);
    expect(caret.hitTest(mixed, { x: 21, y: 1 })).toBe(2);
    expect(caret.hitTest(mixed, { x: 29, y: 1 })).toBe(1);
    expect(caret.indexAtLine(digits, 0, 11)).toBe(2);
    expect(caret.indexAtLine(digits, 0, 29)).toBe(4);
  });

  it('respects the soft wrap, merges per-line boxes, and never hits past the wrap space', () => {
    expect(caret.lineEndIndex(wrapped, 0)).toBe(3);
    expect(caret.indexAtLine(wrapped, 0, 100)).toBeLessThanOrEqual(3);
    expect(caret.hitTest(wrapped, { x: 11, y: 21 })).toBe(6);
    expect(requireSpans(wrapped, 1, 6)).toEqual([
      { line: 0, left: 10, right: 40 },
      { line: 1, left: 0, right: 20 },
    ]);
    expect(requireSpans(wrapped, 4, 4)).toEqual([]);
  });
});

function oldCaretX(layout: TextLayout, index: number): number {
  const lineIndex = caret.lineOf(layout, index);
  const line = layout.lines[lineIndex];
  if (line === undefined) throw new Error('Missing line');
  const glyph = index < line.end ? layout.glyphs.find((item) => item.index === index) : undefined;
  if (glyph) return glyph.x;
  const holder = layout.glyphs.find(
    (item) =>
      item.line === lineIndex && item.glyphId !== null && item.index < index && index < item.end,
  );
  if (holder) {
    const stops = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        layout.text.slice(holder.index, holder.end),
      ),
    ];
    const part = stops.filter(({ index: at }) => holder.index + at <= index).length - 1;
    return holder.x + (holder.advance * part) / stops.length;
  }
  return line.x + line.width;
}

function oldIndex(layout: TextLayout, lineIndex: number, x: number): number {
  for (const glyph of layout.glyphs.filter((item) => item.line === lineIndex)) {
    const count = [
      ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
        layout.text.slice(glyph.index, glyph.end),
      ),
    ].length;
    for (let position = 0; position < count; position += 1) {
      if (x < glyph.x + (glyph.advance * (position + 0.5)) / count) return glyph.index + position;
    }
  }
  return caret.lineEndIndex(layout, lineIndex);
}

const LTR_LAYOUTS = [
  layoutOf('abc', [
    [0, 1, 0, 0],
    [1, 2, 10, 0],
    [2, 3, 20, 0],
  ]),
  {
    ...layoutOf('fi', [[0, 2, 0, 0]]),
    glyphs: [{ ...required(layoutOf('fi', [[0, 2, 0, 0]]).glyphs[0]), advance: 20 }],
    lines: [{ ...required(layoutOf('fi', [[0, 2, 0, 0]]).lines[0]), width: 20 }],
    width: 20,
  },
  layoutOf(
    'ab cd',
    [
      [0, 1, 0, 0],
      [1, 2, 10, 0],
      [2, 3, 20, 0],
      [3, 4, 0, 0, 1],
      [4, 5, 10, 0, 1],
    ],
    [3, 5],
  ),
];

describe('LTR identity acceptance', () => {
  it.each(LTR_LAYOUTS)('preserves current caret and hit-test sweep', (layout) => {
    for (let index = 0; index <= layout.text.length; index += 1) {
      expect(caret.caretRect(layout, index).x).toBe(oldCaretX(layout, index));
    }
    for (const [lineIndex, line] of layout.lines.entries()) {
      for (let x = -2; x <= line.width + 2; x += 0.5) {
        expect(caret.indexAtLine(layout, lineIndex, x)).toBe(oldIndex(layout, lineIndex, x));
      }
    }
  });

  it.each(LTR_LAYOUTS)(
    'exposes the same caret and per-line range geometry through the new APIs',
    (layout) => {
      for (let index = 0; index <= layout.text.length; index += 1) {
        expect(requirePlacement(layout, index)).toEqual({ primary: oldCaretX(layout, index) });
      }
      for (let start = 0; start < layout.text.length; start += 1) {
        for (let end = start + 1; end <= layout.text.length; end += 1) {
          const expected: Span[] = [];
          const first = caret.lineOf(layout, start);
          const last = caret.lineOf(layout, end);
          for (let lineIndex = first; lineIndex <= last; lineIndex += 1) {
            const line = required(layout.lines[lineIndex]);
            const left = lineIndex === first ? oldCaretX(layout, start) : line.x;
            const right = lineIndex === last ? oldCaretX(layout, end) : line.x + line.width;
            if (right > left) expected.push({ line: lineIndex, left, right });
          }
          expect(requireSpans(layout, start, end)).toEqual(expected);
        }
      }
    },
  );
});

describe('real shaped bidi layout acceptance', () => {
  it('keeps placements, leading-edge hits, and selections inside the line box', async () => {
    const text = 'abc שלום xyz';
    const latin = readFileSync(
      new URL('../../../../app/assets/fonts/library/dmsans/400.ttf', import.meta.url),
    );
    const hebrew = readFileSync(
      new URL(
        '../../../../app/assets/fonts/script-coverage/notosanshebrew/400.ttf',
        import.meta.url,
      ),
    );
    const faces = [
      {
        bytes: latin,
        metrics: createFontMetrics(
          { family: 'DM Sans', weight: 400, isItalic: false },
          parseFont(latin),
        ),
      },
      {
        bytes: hebrew,
        metrics: createFontMetrics(
          { family: 'Noto Sans Hebrew', weight: 400, isItalic: false },
          parseFont(hebrew),
        ),
      },
    ];
    const style = (fontFamily: string): TextStyle => ({
      fontFamily,
      fontSize: 20,
      weight: 400,
      italic: false,
      color: [0, 0, 0, 1],
    });
    const runs: StyleRun[] = [
      { length: 4, style: style('DM Sans') },
      { length: 4, style: style('Noto Sans Hebrew') },
      { length: 4, style: style('DM Sans') },
    ];
    const layout = layoutText(text, runs, null, createShapingMeasurer(await loadShaper(), faces));
    expect(layout.glyphs.some((glyph) => glyph.level % 2 === 1)).toBe(true);
    for (let index = 0; index <= text.length; index += 1) {
      const line = required(layout.lines[caret.lineOf(layout, index)]);
      const x = requirePlacement(layout, index).primary;
      expect(x).toBeGreaterThanOrEqual(line.x - 0.001);
      expect(x).toBeLessThanOrEqual(line.x + line.width + 0.001);
    }
    for (const glyph of layout.glyphs) {
      const leading = glyph.level % 2 === 1 ? glyph.x + glyph.advance : glyph.x;
      const hair = glyph.advance / 1000;
      const x = leading + (glyph.level % 2 === 1 ? -hair : hair);
      expect(caret.hitTest(layout, { x, y: required(layout.lines[glyph.line]).y + 1 })).toBe(
        glyph.index,
      );
    }
    for (let start = 0; start < text.length; start += 1) {
      for (const span of requireSpans(layout, start, start + 1)) {
        const line = required(layout.lines[span.line]);
        expect(span.left).toBeGreaterThanOrEqual(line.x - 0.001);
        expect(span.right).toBeLessThanOrEqual(line.x + line.width + 0.001);
      }
    }
  });
});
