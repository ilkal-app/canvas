import { describe, expect, it } from 'vitest';

import { freehandTolerance, type FreehandSample, type ObjectId } from '@canvas/schema';

import type { DrawStyle } from './draw-style.js';
import { freehandObjectsOf, newFreehandObjects } from './new-freehand-objects.js';

const PENCIL: DrawStyle = { tool: 'pencil', stroke: { color: [0, 0, 0, 1], width: 2 } };
const MARKER: DrawStyle = { tool: 'marker', stroke: { color: [0, 0, 1, 1], width: 6 } };
const HIGHLIGHTER: DrawStyle = {
  tool: 'highlighter',
  stroke: { color: [1, 0.75, 0, 1], width: 16 },
  opacity: 0.4,
};

/**
 * Numbered ids.
 *
 * @returns An id generator.
 */
function ids(): () => ObjectId {
  let next = 0;
  return () => `id-${String((next += 1))}` as ObjectId;
}

/**
 * A zig-zag of samples, each with a pressure.
 *
 * @param count - How many.
 * @returns The samples.
 */
function zigzag(count: number): FreehandSample[] {
  return Array.from({ length: count }, (unused, index) => ({
    x: 100 + index * 10,
    y: 50 + (index % 2) * 10,
    pressure: 0.2 + (index % 5) * 0.15,
  }));
}

describe('newFreehandObjects', () => {
  it('places the stroke at its first sample, points relative to it, in the tool’s style', () => {
    const [stroke, ...rest] = newFreehandObjects(zigzag(4), PENCIL, 1, ids());
    expect(rest).toEqual([]);
    expect(stroke).toMatchObject({
      id: 'id-1',
      type: 'freehand',
      parentId: null,
      x: 100,
      y: 50,
      rotation: 0,
      locked: false,
      tool: 'pencil',
      stroke: PENCIL.stroke,
    });
    expect(stroke?.points.slice(0, 2)).toEqual([0, 0]);
    expect(stroke?.points.at(-2)).toBe(30);
    expect(stroke).not.toHaveProperty('pressures');
    expect(stroke).not.toHaveProperty('opacity');
    expect(stroke).not.toHaveProperty('z');
  });

  it('keeps pressures for the marker only', () => {
    const [marker] = newFreehandObjects(zigzag(4), MARKER, 1, ids());
    expect(marker?.pressures).toHaveLength((marker?.points.length ?? 0) / 2);
    const [highlighter] = newFreehandObjects(zigzag(4), HIGHLIGHTER, 1, ids());
    expect(highlighter).not.toHaveProperty('pressures');
  });

  it('gives the highlighter its style’s opacity', () => {
    expect(newFreehandObjects(zigzag(3), HIGHLIGHTER, 1, ids())[0]?.opacity).toBe(0.4);
  });

  it('simplifies a straight run to its ends at the zoom’s tolerance', () => {
    const line = Array.from({ length: 50 }, (unused, index) => ({ x: index, y: 0 }));
    expect(newFreehandObjects(line, PENCIL, 1, ids())[0]?.points).toEqual([0, 0, 49, 0]);
    expect(freehandTolerance(2)).toBe(0.25);
  });

  it('makes a one-point dot of one sample, and nothing of none', () => {
    const [dot] = newFreehandObjects([{ x: 7, y: 8 }], PENCIL, 1, ids());
    expect(dot).toMatchObject({ x: 7, y: 8, points: [0, 0] });
    expect(newFreehandObjects([], PENCIL, 1, ids())).toEqual([]);
  });

  it('splits a stroke longer than the cap into joined pieces, each at its first sample', () => {
    const pieces = newFreehandObjects(zigzag(10), PENCIL, 1, ids(), 4);
    expect(pieces.map((piece) => piece.id)).toEqual(['id-1', 'id-2', 'id-3']);
    expect(pieces.map((piece) => piece.points.length / 2)).toEqual([4, 4, 4]);
    const [first, second] = pieces;
    // The second piece starts where the first ends.
    expect(second?.x).toBeCloseTo((first?.x ?? 0) + (first?.points.at(-2) ?? 0), 9);
    expect(second?.y).toBeCloseTo((first?.y ?? 0) + (first?.points.at(-1) ?? 0), 9);
    expect(second?.points.slice(0, 2)).toEqual([0, 0]);
  });

  it('does not change its input', () => {
    const samples = zigzag(5);
    const copy = structuredClone(samples);
    newFreehandObjects(samples, MARKER, 1, ids());
    expect(samples).toEqual(copy);
  });
});

describe('freehandObjectsOf', () => {
  it('places the samples as they are, unsmoothed, for the preview', () => {
    const [piece] = freehandObjectsOf(zigzag(3), PENCIL, ids());
    expect(piece?.points).toEqual([0, 0, 10, 10, 20, 0]);
  });
});
