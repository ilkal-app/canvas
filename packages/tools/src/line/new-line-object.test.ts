import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { newLineObject } from './new-line-object.js';

describe('newLineObject', () => {
  it('puts the origin on the start and the points in the line’s own frame, in the style', () => {
    const style = {
      stroke: { color: [0, 0, 0, 1] as [number, number, number, number], width: 2 },
      startCap: 'none' as const,
      endCap: 'arrow' as const,
      route: 'elbow' as const,
    };
    expect(newLineObject('l' as ObjectId, { x: 10, y: 20 }, { x: 110, y: -30 }, style)).toEqual({
      id: 'l',
      type: 'line',
      parentId: null,
      x: 10,
      y: 20,
      rotation: 0,
      locked: false,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: -50 },
      ],
      ...style,
    });
  });
});
