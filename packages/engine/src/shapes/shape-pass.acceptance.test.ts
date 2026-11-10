// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { SceneObject } from '../scene/scene-pass.js';

import { SDF_SHAPE_PASS } from './shape-pass.js';
import { shadowPlacementOf, shadowSilhouetteOf } from './shape-shadow.js';

const LOW: Shadow = { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] };
const HIGH: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };
const TRANSFORM = { cos: 0, sin: 1, x: 80, y: 40 } as const;

function record(target: SceneObject, index: number): Float32Array {
  const output = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
  SDF_SHAPE_PASS.prepare(output, target, index);
  return output;
}

describe('SDF_SHAPE_PASS layered shadows', () => {
  it('writes each shadow like its single-layer equivalent, in order, then the body', () => {
    const fields = { width: 80, height: 60, cornerRadius: 12 } as const;
    const layered = shapeObject('layered', { ...fields, shadow: [LOW, HIGH] });
    const target = { object: layered, transform: TRANSFORM };
    expect(SDF_SHAPE_PASS.recordCount(layered)).toBe(3);
    for (const [index, shadow] of [LOW, HIGH].entries()) {
      const single = {
        object: shapeObject(`single-${String(index)}`, { ...fields, shadow }),
        transform: TRANSFORM,
      };
      expect(record(target, index)).toEqual(record(single, 0));
      const silhouette = shadowSilhouetteOf(layered);
      expect(silhouette).toBeDefined();
      if (silhouette !== undefined) {
        expect(SDF_SHAPE_PASS.movePlacement?.(target, index)).toEqual(
          shadowPlacementOf(shadow, silhouette, TRANSFORM),
        );
      }
    }
    const bare = { object: shapeObject('bare', fields), transform: TRANSFORM };
    expect(record(target, 2)).toEqual(record(bare, 0));
    expect(SDF_SHAPE_PASS.movePlacement?.(target, 2)).toEqual(TRANSFORM);
  });

  it('writes only shadows for a gradient body and no records for an unpainted shape', () => {
    const gradient = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { offset: 0, color: [1, 0, 0, 1] as Shadow['color'] },
        { offset: 1, color: [0, 0, 1, 1] as Shadow['color'] },
      ],
    };
    const layered = shapeObject('gradient', { fill: gradient, shadow: [LOW, HIGH] });
    expect(SDF_SHAPE_PASS.recordCount(layered)).toBe(2);
    expect(
      SDF_SHAPE_PASS.recordCount(shapeObject('empty', { fill: null, shadow: [LOW, HIGH] })),
    ).toBe(0);
  });
});
