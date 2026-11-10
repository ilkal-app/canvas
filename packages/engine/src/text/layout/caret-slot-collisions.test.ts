import { describe, expect, it } from 'vitest';

import type { LayoutGlyph, LayoutLine, TextLayout } from '@canvas/text';

import { mixedPlacement } from './caret-bidi.js';
import { visualCaretStep } from './caret.js';

type Glyph = readonly [index: number, x: number, level: number, line?: number];

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

function walk(layout: TextLayout, from: number, direction: -1 | 1): number[] {
  const visited = [from];
  for (let press = 1; press < layout.text.length + 1; press += 1) {
    const next = visualCaretStep(layout, visited[press - 1] ?? from, direction);
    expect(next).toBeDefined();
    visited.push(next ?? from);
  }
  return visited;
}

function expectSlotWalks(layout: TextLayout, slots: readonly number[]): void {
  const right = walk(layout, slots[0] ?? 0, 1);
  const left = walk(layout, slots.at(-1) ?? 0, -1);

  expect(right).toEqual(slots);
  expect(left).toEqual([...slots].reverse());
  expect(new Set(right).size).toBe(slots.length);
  expect(new Set(left).size).toBe(slots.length);
  expect(visualCaretStep(layout, right.at(-1) ?? 0, 1)).toBe(right.at(-1));
  expect(visualCaretStep(layout, left.at(-1) ?? 0, -1)).toBe(left.at(-1));
}

describe('mixed-line caret slot collisions', () => {
  it('walks both collisions around an LTR number nested in an RTL run', () => {
    // With disjoint, positive-width visual boxes, three primaries cannot meet: every index except
    // the last takes its following box's leading edge. At an interior boundary only the box on
    // each side can lead there (left RTL, right LTR). The last index takes a trailing edge, so
    // if it joins a boundary, its box cannot also supply a leading edge there. Two is the maximum.
    // Visual order: a ג 1 2 ב c; levels in text order: 0, 1, 2, 2, 1, 0.
    const layout = layoutOf('aב12גc', [
      [0, 0, 0],
      [1, 40, 1],
      [2, 20, 2],
      [3, 30, 2],
      [4, 10, 1],
      [5, 50, 0],
    ]);

    expect(mixedPlacement(layout, 0, 1)).toEqual({ primary: 50, secondary: 10 });
    expect(mixedPlacement(layout, 0, 5)).toEqual({ primary: 50, secondary: 10 });
    expect(mixedPlacement(layout, 0, 2)).toEqual({ primary: 20, secondary: 40 });
    expect(mixedPlacement(layout, 0, 4)).toEqual({ primary: 20, secondary: 40 });
    expectSlotWalks(layout, [0, 1, 4, 3, 2, 5, 6]);
  });

  it('orders tied indices when a collision secondary is already a primary', () => {
    // Visual order: ב 1 c d. Index 1 cannot move from x=10 to its secondary x=20,
    // because index 2 already holds x=20; indices 0 and 1 remain tied at x=10.
    const layout = layoutOf('1בcd', [
      [0, 10, 2],
      [1, 0, 1],
      [2, 20, 0],
      [3, 30, 0],
    ]);

    expect(mixedPlacement(layout, 0, 0)).toEqual({ primary: 10 });
    expect(mixedPlacement(layout, 0, 1)).toEqual({ primary: 10, secondary: 20 });
    expect(mixedPlacement(layout, 0, 2)).toEqual({ primary: 20, secondary: 0 });
    expectSlotWalks(layout, [0, 1, 2, 3, 4]);
  });
});
