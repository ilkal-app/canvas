import { describe, expect, it } from 'vitest';

import * as engine from '@canvas/engine';
import type { LayoutGlyph, LayoutLine, TextLayout } from '@canvas/text';

type Glyph = readonly [index: number, x: number, level: number, line?: number];

const visualCaretStep = Reflect.get(engine, 'visualCaretStep') as
  ((layout: TextLayout, index: number, direction: -1 | 1) => number | undefined) | undefined;

function step(layout: TextLayout, index: number, direction: -1 | 1): number | undefined {
  if (visualCaretStep === undefined) throw new Error('visualCaretStep must be exported by engine');
  return visualCaretStep(layout, index, direction);
}

/**
 * The carets a run of presses visits from an index, one press more than the text has stops.
 *
 * @param layout - The laid-out text.
 * @param from - The first caret index.
 * @param direction - −1 left, 1 right.
 * @returns Each press's caret index.
 */
function walk(layout: TextLayout, from: number, direction: -1 | 1): (number | undefined)[] {
  const visited: (number | undefined)[] = [];
  let index: number | undefined = from;
  for (let press = 0; press <= layout.text.length; press += 1) {
    index = index === undefined ? undefined : step(layout, index, direction);
    visited.push(index);
  }
  return visited;
}

function layoutOf(text: string, specs: readonly Glyph[], ends = [text.length]): TextLayout {
  const lines: LayoutLine[] = ends.map((end, line) => {
    const start = line === 0 ? 0 : (ends[line - 1] ?? 0);
    const width = Math.max(
      0,
      ...specs.filter((item) => (item[3] ?? 0) === line).map((item) => item[1] + 10),
    );
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
  const glyphs: LayoutGlyph[] = specs.map(([index, x, level, line = 0]) => ({
    codepoint: text.codePointAt(index) ?? 0,
    index,
    end: index + 1,
    glyphId: 1,
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

const RTL = layoutOf('אבג', [
  [0, 20, 1],
  [1, 10, 1],
  [2, 0, 1],
]);
const MIXED = layoutOf('aאבb', [
  [0, 0, 0],
  [1, 20, 1],
  [2, 10, 1],
  [3, 30, 0],
]);
const DIGITS = layoutOf('אב12ג', [
  [0, 40, 1],
  [1, 30, 1],
  [2, 10, 2],
  [3, 20, 2],
  [4, 0, 1],
]);
const WRAPPED = layoutOf(
  'אבcd',
  [
    [0, 10, 1],
    [1, 0, 1],
    [2, 0, 0, 1],
    [3, 10, 0, 1],
  ],
  [2, 4],
);
const RTL_AFTER_WRAP = layoutOf(
  'cd אב',
  [
    [0, 0, 0],
    [1, 10, 0],
    [2, 20, 0],
    [3, 10, 1, 1],
    [4, 0, 1, 1],
  ],
  [3, 5],
);
const LTR = layoutOf('abc', [
  [0, 0, 0],
  [1, 10, 0],
  [2, 20, 0],
]);

describe('visualCaretStep acceptance', () => {
  it('lets text-order navigation own an LTR line', () => {
    expect(step(LTR, 0, 1)).toBeUndefined();
    expect(step(LTR, 2, -1)).toBeUndefined();
  });

  it('walks every all-RTL grapheme in screen order and clamps at both visual edges', () => {
    expect([3, 2, 1, 0].map((index) => step(RTL, index, 1))).toEqual([2, 1, 0, 0]);
    expect([0, 1, 2, 3].map((index) => step(RTL, index, -1))).toEqual([1, 2, 3, 3]);
  });

  it('walks LTR–RTL–LTR text one visual boundary a key, never revisiting a split caret', () => {
    // At a split caret two indices share a primary x; each visual boundary holds one of them, so
    // a run of presses goes on instead of alternating between them.
    expect(walk(MIXED, 0, 1)).toEqual([1, 2, 3, 4, 4]);
    expect(walk(MIXED, 4, -1)).toEqual([3, 2, 1, 0, 0]);
  });

  it('steps across an embedded LTR number in an RTL line, in both directions', () => {
    expect(walk(DIGITS, 5, 1)).toEqual([4, 3, 2, 1, 0, 0]);
    expect(walk(DIGITS, 0, -1)).toEqual([1, 2, 3, 4, 5, 5]);
  });

  it('clamps at the first RTL start edge and delegates the following LTR line', () => {
    expect(step(WRAPPED, 0, 1)).toBe(0);
    expect(step(WRAPPED, 1, -1)).toBe(2);
    expect(step(WRAPPED, 2, 1)).toBeUndefined();
    expect(step(WRAPPED, 3, -1)).toBeUndefined();
  });

  it('moves off the RTL start edge to the preceding soft line end', () => {
    expect(engine.lineEndIndex(RTL_AFTER_WRAP, 0)).toBe(2);
    expect(step(RTL_AFTER_WRAP, 3, 1)).toBe(2);
  });
});
