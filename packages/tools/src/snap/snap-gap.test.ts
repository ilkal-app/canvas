import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '@canvas/engine';

import { gapLabelOf, gapsOf } from './snap-gap.js';

/** The dragged box: 176 × 112 at (428, 128), the E2 frame's PROOF note. */
const BOX: WorldBounds = { minX: 428, minY: 128, maxX: 604, maxY: 240 };

function box(minX: number, minY: number, width: number, height: number): WorldBounds {
  return { minX, minY, maxX: minX + width, maxY: minY + height };
}

describe('gapsOf', () => {
  it('measures the run to the nearest facing neighbour on the left, across their shared span', () => {
    // The TURN note, 24 units left of the box, on the same row.
    const turn = box(228, 128, 176, 112);
    expect(gapsOf(BOX, [turn])).toEqual([{ axis: 'x', from: 404, to: 428, position: 184 }]);
  });

  it('keeps only the nearest neighbour on each side, before then after, x then y', () => {
    const farLeft = box(0, 128, 100, 112);
    const nearLeft = box(300, 150, 100, 50);
    const right = box(640, 100, 50, 50);
    const below = box(450, 300, 40, 40);
    const above = box(500, 0, 40, 40);
    expect(gapsOf(BOX, [farLeft, right, below, nearLeft, above])).toEqual([
      { axis: 'x', from: 400, to: 428, position: 175 },
      { axis: 'x', from: 604, to: 640, position: 139 },
      { axis: 'y', from: 40, to: 128, position: 520 },
      { axis: 'y', from: 240, to: 300, position: 470 },
    ]);
  });

  it('leaves out neighbours that do not face the box, touch it or overlap it', () => {
    const diagonal = box(0, 0, 100, 100);
    const touching = box(604, 128, 50, 50);
    const overlapping = box(500, 200, 200, 200);
    const cornerOnly = box(300, 240, 128, 50);
    expect(gapsOf(BOX, [diagonal, touching, overlapping, cornerOnly])).toEqual([]);
  });

  it('finds nothing without candidates, and does not change its inputs', () => {
    const candidates = Object.freeze([Object.freeze(box(228, 128, 176, 112))]);
    const frozen = Object.freeze({ ...BOX });
    expect(gapsOf(frozen, [])).toEqual([]);
    expect(gapsOf(frozen, candidates)).toHaveLength(1);
  });
});

describe('gapLabelOf', () => {
  it('shows the run in whole world units', () => {
    expect(gapLabelOf({ axis: 'x', from: 404, to: 428, position: 0 })).toBe('24');
    expect(gapLabelOf({ axis: 'y', from: 10.2, to: 22.7, position: 0 })).toBe('13');
  });
});
