import { describe, expect, it } from 'vitest';

import { isInk } from '../fields/color.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';

import { paintBoxOf, paintUnitPoint } from './paint-box.js';

describe('paintBoxOf', () => {
  it('is a shape’s or frame’s own box, and a path’s network bounds', () => {
    const shape = sampleObject('shape', 's', { width: 40, height: 20 });
    expect(paintBoxOf(shape)).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    const frame = sampleObject('frame', 'f', { width: 10, height: 30 });
    expect(paintBoxOf(frame)).toEqual({ x: 0, y: 0, width: 10, height: 30 });
    const path = sampleObject('path', 'p', {
      vertices: [
        { id: 'a', x: -10, y: 5, mirror: 'none' },
        { id: 'b', x: 30, y: 25, mirror: 'none' },
      ],
      segments: [{ id: 's', a: 'a', b: 'b', ha: { x: 0, y: -15 }, hb: { x: 0, y: 0 } }],
    });
    expect(paintBoxOf(path)).toEqual({ x: -10, y: -10, width: 40, height: 35 });
  });
});

describe('paintUnitPoint', () => {
  it('maps into the unit square, and an axis of zero extent to its middle', () => {
    const box = { x: -10, y: 10, width: 40, height: 20 };
    expect(paintUnitPoint(box, { x: 10, y: 15 })).toEqual({ u: 0.5, v: 0.25 });
    expect(paintUnitPoint(box, { x: 50, y: 10 })).toEqual({ u: 1.5, v: 0 });
    expect(paintUnitPoint({ x: 0, y: 0, width: 0, height: 0 }, { x: 3, y: 4 })).toEqual({
      u: 0.5,
      v: 0.5,
    });
  });
});

describe('isInk', () => {
  it('is true only for the token', () => {
    expect(isInk('ink')).toBe(true);
    expect(isInk('Ink')).toBe(false);
    expect(isInk([0, 0, 0, 1])).toBe(false);
  });
});

describe('pathBounds of a broken network', () => {
  it('skips a segment whose vertex is missing', () => {
    const path = sampleObject('path', 'p', {
      vertices: [{ id: 'a', x: 1, y: 2, mirror: 'none' }],
      segments: [{ id: 's', a: 'a', b: 'z', ha: { x: 50, y: 50 }, hb: { x: 0, y: 0 } }],
    });
    expect(paintBoxOf(path)).toEqual({ x: 1, y: 2, width: 0, height: 0 });
  });
});
