import { describe, expect, it } from 'vitest';

import { stickyObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';

import { SDF_SHAPE_PASS } from './shape-pass.js';

const bits = (values: readonly number[]) => [...new Uint32Array(new Float32Array(values).buffer)];

describe('sticky retained placements', () => {
  it('matches full record origin/axis bits for both paper and shadow', () => {
    const object = stickyObject('sticky');
    for (const x of [-0, 0.1, 16_777_217.125, -1e20]) {
      for (const angle of [0, -0.731, Math.PI]) {
        const target = {
          object,
          transform: { x, y: -x, cos: Math.cos(angle), sin: Math.sin(angle) },
        };
        for (let index = 0; index < 2; index += 1) {
          const record = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
          SDF_SHAPE_PASS.prepare(record, target, index);
          const placement = SDF_SHAPE_PASS.movePlacement?.(target, index);
          expect(placement).toBeDefined();
          if (!placement) throw new Error('Expected sticky placement.');
          expect(bits([placement.x, placement.y, placement.cos, placement.sin])).toEqual(
            bits([record[0] ?? 0, record[1] ?? 0, record[11] ?? 0, record[12] ?? 0]),
          );
        }
      }
    }
  });
});
