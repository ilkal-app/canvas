import { describe, expect, it } from 'vitest';

import { quadraticSplit } from './quadratic-split.js';
import { strPack } from './str-pack.js';

function box(minX: number, minY: number, size = 1) {
  return { minX, minY, maxX: minX + size, maxY: minY + size };
}

describe('quadraticSplit', () => {
  it('separates two distant clusters into their own groups', () => {
    const entries = [box(0, 0), box(100, 0), box(1, 1), box(101, 1), box(0, 2), box(100, 2)];
    const [first, second] = quadraticSplit(entries, 2);
    const groups = [first, second].map((group) => group.map((entry) => entry.minX < 50));
    expect(groups.sort()).toEqual([
      [false, false, false],
      [true, true, true],
    ]);
  });

  it('gives a group every remaining entry when it needs them all to reach the minimum', () => {
    const entries = [box(0, 0), box(100, 100), box(1, 1), box(2, 2), box(3, 3)];
    const [first, second] = quadraticSplit(entries, 2);
    expect(Math.min(first.length, second.length)).toBeGreaterThanOrEqual(2);
    expect(first.length + second.length).toBe(5);
  });

  it('breaks growth ties by the smaller group box, then the smaller group', () => {
    const entries = [box(0, 0), box(10, 0), box(5, 0, 0)];
    const [first, second] = quadraticSplit(entries, 1);
    expect(first.length + second.length).toBe(3);
  });

  it('needs at least two entries', () => {
    expect(() => quadraticSplit([box(0, 0)], 1)).toThrow(RangeError);
  });
});

describe('strPack', () => {
  it('packs boxes into groups of at most the capacity, each box once', () => {
    const boxes = Array.from({ length: 100 }, (unused, index) =>
      box(index % 10, Math.floor(index / 10)),
    );
    const groups = strPack(boxes, 16);
    expect(groups.every((group) => group.length <= 16 && group.length >= 8)).toBe(true);
    expect(new Set(groups.flat()).size).toBe(100);
  });
});
