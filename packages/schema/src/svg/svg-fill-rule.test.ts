import { describe, expect, it } from 'vitest';

import { nonzeroDiffersFromEvenOdd } from './svg-fill-rule.js';
import { readPathData } from './svg-path-data.js';

const differs = (data: string): boolean | undefined =>
  nonzeroDiffersFromEvenOdd(readPathData(data).subpaths);

describe('nonzeroDiffersFromEvenOdd', () => {
  it('agrees for a hole drawn in the opposite direction, and for disjoint shapes', () => {
    expect(differs('M0 0 H100 V100 H0 Z M25 25 V75 H75 V25 Z')).toBe(false);
    expect(differs('M0 0 H10 V10 H0 Z M20 0 H30 V10 H20 Z')).toBe(false);
    expect(differs('M0 0 L10 0 L10 10')).toBe(false);
  });

  it('differs for a hole drawn in the same direction, overlapping shapes and a self-crossing star', () => {
    expect(differs('M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z')).toBe(true);
    expect(differs('M0 0 H60 V60 H0 Z M30 30 H90 V90 H30 Z')).toBe(true);
    // A pentagram drawn in one stroke: its centre winds twice.
    expect(differs('M50 0 L79 90 L2 35 L98 35 L21 90 Z')).toBe(true);
  });

  it('checks curves by flattening them', () => {
    const circle = (cx: number, r: number): string =>
      `M${String(cx - r)} 50 A${String(r)} ${String(r)} 0 1 1 ${String(cx + r)} 50 A${String(r)} ${String(r)} 0 1 1 ${String(cx - r)} 50 Z`;
    expect(differs(`${circle(50, 40)} ${circle(70, 40)}`)).toBe(true);
    expect(differs(`${circle(50, 10)} ${circle(150, 10)}`)).toBe(false);
  });

  it('gives up on outlines with too many edges or crossings', () => {
    const zigzag = Array.from(
      { length: 2_001 },
      (unused, index) => `L${String(index)} ${String(index % 2)}`,
    );
    expect(differs(`M0 0 ${zigzag.join(' ')}`)).toBeUndefined();
    // 300 horizontal and 300 vertical lines all crossing: far more samples than allowed.
    const grid = Array.from(
      { length: 300 },
      (unused, index) =>
        `M0 ${String(index)} L1000 ${String(index)} Z M${String(index)} 0 L${String(index)} 1000 Z`,
    );
    expect(differs(grid.join(' '))).toBeUndefined();
  });
});
