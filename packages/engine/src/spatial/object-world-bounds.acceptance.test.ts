// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import { frameObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { shadowMarginOf } from '../shapes/shape-shadow.js';

import { worldBoundsOf } from './object-world-bounds.js';

const NEAR: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };
const FAR: Shadow = { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] };
const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;

describe('worldBoundsOf layered shadows', () => {
  it('uses the largest drawn margin even when that layer is last', () => {
    const margin = shadowMarginOf(FAR);
    for (const object of [
      shapeObject('shape', { shadow: [NEAR, FAR] }),
      frameObject('frame', { shadow: [NEAR, FAR] }),
    ]) {
      const bounds = worldBoundsOf(object, IDENTITY);
      expect(bounds?.minX).toBeCloseTo(-margin, 9);
      expect(bounds?.minY).toBeCloseTo(-margin, 9);
      expect(bounds?.maxX).toBeCloseTo(object.width + margin, 9);
      expect(bounds?.maxY).toBeCloseTo(object.height + margin, 9);
    }
  });

  it('ignores a transparent layer even when its geometric reach is largest', () => {
    const clear: Shadow = { ...FAR, color: [0, 0, 0, 0] };
    const margin = shadowMarginOf(NEAR);
    const bounds = worldBoundsOf(shapeObject('shape', { shadow: [NEAR, clear] }), IDENTITY);
    expect(bounds?.minY).toBeCloseTo(-margin, 9);
  });
});
