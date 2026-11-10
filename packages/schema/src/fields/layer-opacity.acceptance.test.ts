// (layer opacity): only drawable layers share optional unit opacity.
import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { boardObjectSchema } from '../objects/board-object.js';
import { imageObjectSchema } from '../objects/image-object.js';
import { shapeObjectSchema } from '../objects/shape-object.js';

import { layerShape } from './opacity.js';

const LAYERS = [
  'text',
  'sticky',
  'shape',
  'line',
  'connector',
  'path',
  'group',
  'frame',
  'component',
  'instance',
] as const;

describe('layer opacity schema', () => {
  it.each(LAYERS)('%s accepts absence and the closed unit interval', (type) => {
    const sample = sampleObject(type, type);
    expect(boardObjectSchema.parse(sample)).not.toHaveProperty('opacity');
    for (const opacity of [0, 0.5, 1]) {
      expect(boardObjectSchema.parse({ ...sample, opacity })).toMatchObject({ opacity });
    }
  });

  it.each(LAYERS)('%s refuses values outside the image opacity rules', (type) => {
    const sample = sampleObject(type, type);
    for (const opacity of [-0.1, 1.1, Number.NaN, '0.5', null, true]) {
      expect(boardObjectSchema.safeParse({ ...sample, opacity }).success).toBe(false);
    }
  });

  it.each(['comment', 'video'] as const)('%s refuses opacity', (type) => {
    expect(boardObjectSchema.safeParse({ ...sampleObject(type, type), opacity: 0.5 }).success).toBe(
      false,
    );
  });

  it('defines the reusable layer field in fields/opacity.ts', () => {
    expect(layerShape.opacity.safeParse(0.5).success).toBe(true);
    expect(layerShape.opacity.safeParse(2).success).toBe(false);
  });

  it('uses the image opacity description, while images retain their own field', () => {
    expect(shapeObjectSchema.shape.opacity.description).toBe(
      imageObjectSchema.shape.opacity.description,
    );
    expect(
      imageObjectSchema.parse({ ...sampleObject('image', 'image'), opacity: 0.5 }),
    ).toHaveProperty('opacity', 0.5);
  });
});
