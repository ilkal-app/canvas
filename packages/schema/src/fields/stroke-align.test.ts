import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { frameObjectSchema } from '../objects/frame-object.js';
import { shapeObjectSchema } from '../objects/shape-object.js';

import {
  DEFAULT_STROKE_ALIGN,
  frameStrokeFieldSchema,
  STROKE_ALIGNS,
  strokeAlignFieldSchema,
  strokeOutsetOf,
  strokeOutsideFraction,
} from './stroke-align.js';

describe('strokeAlign', () => {
  it('is optional on shapes and frames, absent on objects stored before it, and strict', () => {
    expect(strokeAlignFieldSchema.safeParse(undefined).success).toBe(true);
    expect(strokeAlignFieldSchema.safeParse(null).success).toBe(false);
    const shape = sampleObject('shape', 'shape-1');
    const frame = sampleObject('frame', 'frame-1');
    expect(shapeObjectSchema.parse(shape)).not.toHaveProperty('strokeAlign');
    expect(frameObjectSchema.parse(frame)).not.toHaveProperty('strokeAlign');
    for (const strokeAlign of STROKE_ALIGNS) {
      expect(shapeObjectSchema.parse({ ...shape, strokeAlign }).strokeAlign).toBe(strokeAlign);
      expect(frameObjectSchema.parse({ ...frame, strokeAlign }).strokeAlign).toBe(strokeAlign);
    }
    expect(shapeObjectSchema.safeParse({ ...shape, strokeAlign: 'middle' }).success).toBe(false);
    expect(DEFAULT_STROKE_ALIGN).toBe('inside');
  });

  it('gives frames an optional, nullable stroke that may be ink, as a shape’s', () => {
    const frame = sampleObject('frame', 'frame-1');
    expect(frameStrokeFieldSchema.safeParse(undefined).success).toBe(true);
    expect(frameObjectSchema.parse(frame)).not.toHaveProperty('stroke');
    for (const stroke of [null, { color: 'ink', width: 1 }, { color: [1, 0, 0, 0.5], width: 64 }]) {
      expect(frameObjectSchema.parse({ ...frame, stroke }).stroke).toEqual(stroke);
    }
    for (const stroke of [{ color: 'ink', width: 0 }, { color: 'Ink', width: 1 }, 'red']) {
      expect(frameObjectSchema.safeParse({ ...frame, stroke }).success).toBe(false);
    }
  });

  it('measures how much of an outline lies outside the edge', () => {
    expect(strokeOutsideFraction(undefined)).toBe(0);
    expect(strokeOutsideFraction('inside')).toBe(0);
    expect(strokeOutsideFraction('center')).toBe(0.5);
    expect(strokeOutsideFraction('outside')).toBe(1);
    // A value that skipped the door reads as inside.
    expect(strokeOutsideFraction('middle')).toBe(0);
    expect(strokeOutsideFraction(1)).toBe(0);
    const stroke = { width: 8 };
    expect(strokeOutsetOf(stroke, undefined)).toBe(0);
    expect(strokeOutsetOf(stroke, 'center')).toBe(4);
    expect(strokeOutsetOf(stroke, 'outside')).toBe(8);
    expect(strokeOutsetOf(null, 'outside')).toBe(0);
    expect(strokeOutsetOf(undefined, 'outside')).toBe(0);
    expect(strokeOutsetOf({ width: 0 }, 'outside')).toBe(0);
    expect(strokeOutsetOf({ width: Number.NaN }, 'outside')).toBe(0);
  });
});
