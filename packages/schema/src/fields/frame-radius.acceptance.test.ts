// A frame stores one radius or four ordered corner radii; shapes stay scalar.
import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { frameObjectSchema } from '../objects/frame-object.js';
import { shapeObjectSchema } from '../objects/shape-object.js';
import { findValueLimitIssues } from '../rules/value-limits.js';

import { BOARD_BOUND } from './board-bound.js';

describe('frame cornerRadius', () => {
  const frame = sampleObject('frame', 'frame');

  it('is optional, scalar or four corners in top-left clockwise order', () => {
    expect(frameObjectSchema.parse(frame)).not.toHaveProperty('cornerRadius');
    expect(frameObjectSchema.parse({ ...frame, cornerRadius: 12 })).toMatchObject({
      cornerRadius: 12,
    });
    expect(frameObjectSchema.parse({ ...frame, cornerRadius: [1, 2, 3, 4] })).toMatchObject({
      cornerRadius: [1, 2, 3, 4],
    });
    expect(
      frameObjectSchema.parse({ ...frame, cornerRadius: [0, BOARD_BOUND, 0, 0] }),
    ).toMatchObject({ cornerRadius: [0, BOARD_BOUND, 0, 0] });
  });

  it.each([-1, [1, -1, 2, 3], [1, 2, 3], [1, 2, 3, 4, 5], ['1', 2, 3, 4], '12', null])(
    'refuses invalid radius %j',
    (cornerRadius) => {
      expect(frameObjectSchema.safeParse({ ...frame, cornerRadius }).success).toBe(false);
    },
  );

  it('reports each over-limit corner at the relay door, as for a shape radius', () => {
    const scalar = frameObjectSchema.parse({ ...frame, cornerRadius: BOARD_BOUND + 1 });
    const tuple = frameObjectSchema.parse({
      ...frame,
      cornerRadius: [0, BOARD_BOUND + 1, 0, BOARD_BOUND + 2],
    });
    expect(findValueLimitIssues(scalar).map(({ path }) => path)).toEqual([['cornerRadius']]);
    expect(findValueLimitIssues(tuple).map(({ path }) => path)).toEqual([
      ['cornerRadius', 1],
      ['cornerRadius', 3],
    ]);
  });

  it('keeps a shape radius scalar', () => {
    const shape = sampleObject('shape', 'shape');
    expect(shapeObjectSchema.safeParse({ ...shape, cornerRadius: [1, 2, 3, 4] }).success).toBe(
      false,
    );
  });
});
