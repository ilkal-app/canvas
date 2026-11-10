import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { covers, meshBounds } from './__fixtures__/mesh-coverage.js';
import { writeDot } from './stroke-caps.js';
import { strokeMesh, writeStroke } from './stroke-mesh.js';
import { TriangleWriter } from './triangle-writer.js';

// Explicit joins (miter with its limit, bevel, round), square caps and dashes.

const TOLERANCE = 0.05;
const points = (...pairs: (readonly [number, number])[]): Point[] =>
  pairs.map(([x, y]) => ({ x, y }));
const rounded = (mesh: Float32Array): number[] => {
  const bounds = meshBounds(mesh);
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map(
    (value) => Math.round(value * 100) / 100,
  );
};

/** An L turning a right angle at (10, 0). */
const ELL = points([0, 0], [10, 0], [10, 10]);

/** A turn back of nearly 180° at (10, 0). */
const HAIRPIN = points([0, 0], [10, 0], [0, 1]);

describe('joins', () => {
  it('mitres a right angle to its corner', () => {
    const mesh = strokeMesh(ELL, 2, false, 'butt', TOLERANCE, { join: 'miter' });
    expect(covers(mesh, 10.9, -0.9)).toBe(true);
    expect(rounded(mesh)).toEqual([0, -1, 11, 10]);
  });

  it('bevels a right angle: the corner cut on the chord between the two edges', () => {
    const mesh = strokeMesh(ELL, 2, false, 'butt', TOLERANCE, { join: 'bevel' });
    expect(covers(mesh, 10.4, -0.4)).toBe(true);
    expect(covers(mesh, 10.6, -0.6)).toBe(false);
    expect(covers(mesh, 10.9, -0.9)).toBe(false);
  });

  it('rounds a right angle with an explicit round join, as with none', () => {
    const round = strokeMesh(ELL, 2, false, 'butt', TOLERANCE, { join: 'round' });
    expect(covers(round, 10.6, -0.6)).toBe(true);
    expect(covers(round, 10.9, -0.9)).toBe(false);
    expect(round).toEqual(strokeMesh(ELL, 2, false, 'butt', TOLERANCE));
  });

  it('bevels a miter longer than the limit, and mitres it under a higher limit', () => {
    // The turn's miter is about 20 widths long.
    const limited = strokeMesh(HAIRPIN, 2, false, 'butt', TOLERANCE, {
      join: 'miter',
      miterLimit: 4,
    });
    expect(meshBounds(limited).maxX).toBeLessThan(11.5);
    expect(limited).toEqual(strokeMesh(HAIRPIN, 2, false, 'butt', TOLERANCE, { join: 'bevel' }));
    const defaulted = strokeMesh(HAIRPIN, 2, false, 'butt', TOLERANCE, { join: 'miter' });
    expect(defaulted).toEqual(limited);
    const long = strokeMesh(HAIRPIN, 2, false, 'butt', TOLERANCE, {
      join: 'miter',
      miterLimit: 25,
    });
    expect(meshBounds(long).maxX).toBeGreaterThan(25);
  });

  // A 30° turn, width 2, tolerance 0.05: its mitre (1 / cos 15° ≈ 1.035 half-widths) stays within
  // the tolerance of a round join, so a round join or none shares it, as before.
  const thirty = points(
    [0, 0],
    [10, 0],
    [10 + 10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)],
  );

  it('shares the mitre at a gentle turn for a round join or none, as before', () => {
    const plain = strokeMesh(thirty, 2, false, 'butt', TOLERANCE);
    expect(strokeMesh(thirty, 2, false, 'butt', TOLERANCE, { join: 'round' })).toEqual(plain);
    expect(strokeMesh(thirty, 2, false, 'butt', TOLERANCE, {})).toEqual(plain);
  });

  it('mitres a gentle turn whose miter is within the limit, and bevels one just past it', () => {
    const plain = strokeMesh(thirty, 2, false, 'butt', TOLERANCE);
    const within = { join: 'miter', miterLimit: 1.04 } as const;
    expect(strokeMesh(thirty, 2, false, 'butt', TOLERANCE, within)).toEqual(plain);
    const past = { join: 'miter', miterLimit: 1 } as const;
    const bevel = strokeMesh(thirty, 2, false, 'butt', TOLERANCE, { join: 'bevel' });
    expect(strokeMesh(thirty, 2, false, 'butt', TOLERANCE, past)).toEqual(bevel);
    expect(bevel).not.toEqual(plain);
  });

  it('bevels a gentle turn with an explicit bevel: nothing past the chord', () => {
    const bevel = strokeMesh(thirty, 2, false, 'butt', TOLERANCE, { join: 'bevel' });
    const plain = strokeMesh(thirty, 2, false, 'butt', TOLERANCE);
    // The outer side of the turn is the −y side: the mitre reaches 1 / cos 15° ≈ 1.035 from the
    // corner along the outer bisector (sin 15°, −cos 15°), the bevel's chord only cos 15° ≈ 0.966.
    const at = (reach: number) => ({
      x: 10 + Math.sin(Math.PI / 12) * reach,
      y: -Math.cos(Math.PI / 12) * reach,
    });
    const tip = at(1.0);
    expect(covers(plain, tip.x, tip.y)).toBe(true);
    expect(covers(bevel, tip.x, tip.y)).toBe(false);
    const inside = at(0.9);
    expect(covers(bevel, inside.x, inside.y)).toBe(true);
  });

  it('mitres a miter exactly at its limit, and bevels it just past the limit', () => {
    // A 120° turn at (10, 0): the outgoing direction is exactly (−0.5, √3 / 2) and cos 60° is
    // exactly 0.5, so the miter is exactly 2 widths long. Like SVG, only a miter longer than the
    // limit is bevelled: at the limit it stays mitred.
    const turn = points([0, 0], [10, 0], [5, 5 * Math.sqrt(3)]);
    const bevel = strokeMesh(turn, 2, false, 'butt', TOLERANCE, { join: 'bevel' });
    const atLimit = strokeMesh(turn, 2, false, 'butt', TOLERANCE, { join: 'miter', miterLimit: 2 });
    expect(atLimit).not.toEqual(bevel);
    // The outer side is −y; the miter's tip is 2 from the corner along (cos 30°, −sin 30°), the
    // bevel's chord only 0.5.
    const at = (reach: number) => ({
      x: 10 + Math.cos(Math.PI / 6) * reach,
      y: -Math.sin(Math.PI / 6) * reach,
    });
    const probe = at(1.9);
    expect(covers(atLimit, probe.x, probe.y)).toBe(true);
    expect(covers(bevel, probe.x, probe.y)).toBe(false);
    // The next number below 2.
    const pastLimit = { join: 'miter', miterLimit: 2 - Number.EPSILON } as const;
    expect(strokeMesh(turn, 2, false, 'butt', TOLERANCE, pastLimit)).toEqual(bevel);
  });

  it('joins round where a point is not a corner', () => {
    const writer = new TriangleWriter();
    writeStroke(writer, ELL, 2, false, 'butt', TOLERANCE, { join: 'miter' }, [true, false, true]);
    expect(writer.toFloat32Array()).toEqual(strokeMesh(ELL, 2, false, 'butt', TOLERANCE));
  });

  it('keeps a repeated point’s corner flag, open and where a closed polyline repeats its start', () => {
    const repeated = points([0, 0], [10, 0], [10, 0], [10, 10]);
    const writer = new TriangleWriter();
    writeStroke(writer, repeated, 2, false, 'butt', TOLERANCE, { join: 'miter' }, [
      true,
      false,
      true,
      true,
    ]);
    expect(writer.toFloat32Array()).toEqual(
      strokeMesh(ELL, 2, false, 'butt', TOLERANCE, { join: 'miter' }),
    );
    const square = points([0, 0], [10, 0], [10, 10], [0, 10]);
    const closing = new TriangleWriter();
    writeStroke(
      closing,
      [...square, { x: 0, y: 0 }],
      2,
      true,
      'butt',
      TOLERANCE,
      { join: 'miter' },
      [false, true, true, true, true],
    );
    expect(closing.toFloat32Array()).toEqual(
      strokeMesh(square, 2, true, 'butt', TOLERANCE, { join: 'miter' }),
    );
  });

  it('mitres the corners of a closed polygon', () => {
    const square = points([0, 0], [10, 0], [10, 10], [0, 10]);
    const mesh = strokeMesh(square, 2, true, 'butt', TOLERANCE, { join: 'miter' });
    expect(rounded(mesh)).toEqual([-1, -1, 11, 11]);
    expect(covers(mesh, -0.9, -0.9)).toBe(true);
  });
});

describe('square caps', () => {
  it('run half the width past each end, covering the corners a round cap leaves', () => {
    const mesh = strokeMesh(points([0, 0], [10, 0]), 2, false, 'square', TOLERANCE);
    expect(rounded(mesh)).toEqual([-1, -1, 11, 1]);
    expect(covers(mesh, -0.9, 0.9)).toBe(true);
    expect(covers(mesh, 10.9, -0.9)).toBe(true);
  });

  it('draw a lone point as a square, and butt caps draw nothing there', () => {
    const square = strokeMesh(points([5, 5]), 2, false, 'square', TOLERANCE);
    expect(rounded(square)).toEqual([4, 4, 6, 6]);
    expect(strokeMesh(points([5, 5]), 2, false, 'butt', TOLERANCE)).toHaveLength(0);
  });

  it('turn a dot along the stroke’s direction', () => {
    const writer = new TriangleWriter();
    const diagonal = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    writeDot(writer, 'square', { x: 0, y: 0 }, diagonal, 1, TOLERANCE);
    const mesh = writer.toFloat32Array();
    expect(covers(mesh, 0, 1.3)).toBe(true);
    expect(covers(mesh, 0.9, 0.9)).toBe(false);
    const none = new TriangleWriter();
    writeDot(none, 'butt', { x: 0, y: 0 }, diagonal, 1, TOLERANCE);
    expect(none.toFloat32Array()).toHaveLength(0);
    const round = new TriangleWriter();
    writeDot(round, 'round', { x: 0, y: 0 }, diagonal, 1, TOLERANCE);
    expect(rounded(round.toFloat32Array())).toEqual([-1, -1, 1, 1]);
  });
});

describe('dashes', () => {
  const straight = points([0, 0], [20, 0]);

  it('draws the dashes and leaves the gaps, ending each dash in the cap', () => {
    const outline = { dash: { pattern: [5, 5], offset: 0 }, cap: 'butt' } as const;
    const butt = strokeMesh(straight, 2, false, 'butt', TOLERANCE, outline);
    expect(covers(butt, 2, 0)).toBe(true);
    expect(covers(butt, 7, 0)).toBe(false);
    expect(covers(butt, 12, 0)).toBe(true);
    expect(covers(butt, 17, 0)).toBe(false);
    expect(rounded(butt)).toEqual([0, -1, 15, 1]);
    const round = strokeMesh(straight, 2, false, 'butt', TOLERANCE, { ...outline, cap: 'round' });
    expect(covers(round, 5.5, 0)).toBe(true);
    // The stroke's own start keeps its butt cap.
    expect(covers(round, -0.5, 0)).toBe(false);
  });

  it('carries a dash around a corner, with the join', () => {
    const outline = { dash: { pattern: [14, 2], offset: 0 }, join: 'miter', cap: 'butt' } as const;
    const mesh = strokeMesh(ELL, 2, false, 'butt', TOLERANCE, outline);
    expect(covers(mesh, 10.9, -0.9)).toBe(true);
    expect(covers(mesh, 10, 3)).toBe(true);
    expect(covers(mesh, 10, 15)).toBe(false);
  });

  it('draws dashes of length 0 as dots with round caps', () => {
    const outline = { dash: { pattern: [0, 5], offset: 0 }, cap: 'round' } as const;
    const mesh = strokeMesh(straight, 2, false, 'butt', TOLERANCE, outline);
    for (const x of [0, 5, 10, 15, 20]) expect(covers(mesh, x + 0.5, 0)).toBe(true);
    expect(covers(mesh, 2.5, 0)).toBe(false);
  });

  it('draws a closed polyline whose one dash covers it as the closed stroke', () => {
    const square = points([0, 0], [10, 0], [10, 10], [0, 10]);
    const outline = { dash: { pattern: [100, 10], offset: 0 } };
    expect(strokeMesh(square, 2, true, 'butt', TOLERANCE, outline)).toEqual(
      strokeMesh(square, 2, true, 'butt', TOLERANCE),
    );
    const dashed = strokeMesh(square, 2, true, 'butt', TOLERANCE, {
      dash: { pattern: [6, 4], offset: 2 },
      cap: 'butt',
    });
    // Over the closing corner: the dash from 38 to 4 (offset 2) runs through (0, 0).
    expect(covers(dashed, -0.5, -0.5)).toBe(true);
    expect(covers(dashed, 6, 0)).toBe(false);
  });

  it('draws solid when the pattern would cut too many dashes', () => {
    const long = points([0, 0], [100_000, 0]);
    const outline = { dash: { pattern: [1, 1], offset: 0 } };
    expect(strokeMesh(long, 2, false, 'butt', TOLERANCE, outline)).toEqual(
      strokeMesh(long, 2, false, 'butt', TOLERANCE),
    );
  });
});
