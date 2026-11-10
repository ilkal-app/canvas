import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from '../drawable/drawable-values.js';
import { boardObjectSchema } from '../objects/board-object.js';

import { LAYER_OPACITY_TYPES, layerOpacityOf, opacitySchema } from './opacity.js';

describe('layer opacity', () => {
  it('reads a stored opacity as drawn, absent and refused values as opaque', () => {
    expect(layerOpacityOf(0)).toBe(0);
    expect(layerOpacityOf(0.25)).toBe(0.25);
    expect(layerOpacityOf(1)).toBe(1);
    for (const refused of [undefined, null, -0.1, 1.5, Number.NaN, '0.5', [0.5]]) {
      expect(layerOpacityOf(refused)).toBe(1);
    }
  });

  it('lists the types whose schema takes the optional field', () => {
    expect(LAYER_OPACITY_TYPES).not.toContain('image');
    expect(LAYER_OPACITY_TYPES).not.toContain('comment');
    expect(LAYER_OPACITY_TYPES).not.toContain('video');
    const options = boardObjectSchema.options.map((option) => option.shape);
    for (const type of LAYER_OPACITY_TYPES) {
      const shape = options.find((candidate) => candidate.type.value === type);
      expect(shape && 'opacity' in shape, type).toBe(true);
    }
  });

  it('is the image’s own required field', () => {
    expect(opacitySchema.safeParse(undefined).success).toBe(false);
    expect(opacitySchema.safeParse(0.5).success).toBe(true);
  });
});

describe('the door’s judgement of an opacity', () => {
  it('refuses a style group’s opacity outside [0, 1] or not a number, and passes one inside', () => {
    expect(drawableValuesReason('style', { opacity: 0.5 })).toBeUndefined();
    expect(drawableValuesReason('style', {})).toBeUndefined();
    expect(drawableValuesReason('style', { opacity: 1.5 })).toEqual({
      field: 'opacity',
      reason: 'out-of-range',
    });
    expect(drawableValuesReason('style', { opacity: Number.NaN })).toEqual({
      field: 'opacity',
      reason: 'not-finite',
    });
    expect(drawableValuesReason('style', { opacity: '0.5' })).toEqual({
      field: 'opacity',
      reason: 'not-a-number',
    });
  });

  it('passes a refused opacity written as the board already holds it', () => {
    const stored = { value: { opacity: 2 } };
    expect(drawableValuesReason('style', { opacity: 2 }, () => stored)).toBeUndefined();
  });
});
