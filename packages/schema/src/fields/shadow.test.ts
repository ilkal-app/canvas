import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { frameObjectSchema } from '../objects/frame-object.js';
import { shapeObjectSchema } from '../objects/shape-object.js';

import { DEFAULT_SHADOW, shadowFieldSchema, shadowSchema } from './shadow.js';

describe('shadowSchema', () => {
  it('accepts the default shadow, which is frozen', () => {
    expect(shadowSchema.parse(DEFAULT_SHADOW)).toEqual(DEFAULT_SHADOW);
    expect(Object.isFrozen(DEFAULT_SHADOW)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SHADOW.color)).toBe(true);
  });

  it('refuses ink, unknown keys and a negative blur', () => {
    expect(shadowSchema.safeParse({ ...DEFAULT_SHADOW, color: 'ink' }).success).toBe(false);
    expect(shadowSchema.safeParse({ ...DEFAULT_SHADOW, inset: true }).success).toBe(false);
    expect(shadowSchema.safeParse({ ...DEFAULT_SHADOW, blur: -1 }).success).toBe(false);
  });

  it('is optional and nullable on shapes and frames, and absent on objects stored before it', () => {
    expect(shadowFieldSchema.safeParse(undefined).success).toBe(true);
    expect(shadowFieldSchema.safeParse(null).success).toBe(true);
    const shape = sampleObject('shape', 'shape-1');
    const frame = sampleObject('frame', 'frame-1');
    expect(shapeObjectSchema.parse(shape)).not.toHaveProperty('shadow');
    expect(frameObjectSchema.parse(frame)).not.toHaveProperty('shadow');
    for (const shadow of [null, DEFAULT_SHADOW]) {
      expect(shapeObjectSchema.parse({ ...shape, shadow }).shadow).toEqual(shadow);
      expect(frameObjectSchema.parse({ ...frame, shadow }).shadow).toEqual(shadow);
    }
    expect(shapeObjectSchema.safeParse({ ...shape, shadow: { x: 1 } }).success).toBe(false);
  });
});
