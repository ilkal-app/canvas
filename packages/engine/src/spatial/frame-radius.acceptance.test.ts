// Rounded frame hit, bounds and nested clip geometry agree with rendering.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  sourceOf,
} from '../scene/__fixtures__/scene-objects.js';

import { clipChainOf, isInsideClipChain } from './clip-chain.js';
import { hitPoint } from './hit-point.js';
import { worldBoundsOf } from './object-world-bounds.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

function indexed(...objects: BoardObject[]) {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { document, index };
}

describe('rounded frame spatial geometry', () => {
  it('misses the empty corner inside the box and hits the rounded interior', () => {
    const { document, index } = indexed(
      frameObject('f', { width: 100, height: 80, cornerRadius: 30 }),
    );
    expect(hitPoint(index, document, { x: 2, y: 2 }, { zoom: 1, tolerancePx: 0 })).toEqual([]);
    expect(hitPoint(index, document, { x: 30, y: 30 }, { zoom: 1, tolerancePx: 0 })).toEqual(['f']);
    expect(hitPoint(index, document, { x: 95, y: 5 }, { zoom: 1, tolerancePx: 0 })).toEqual([]);
  });

  it('uses capped rounded geometry for a rotated frame world bound', () => {
    const transform = { x: 0, y: 0, cos: Math.SQRT1_2, sin: Math.SQRT1_2 };
    const square = frameObject('square', { width: 100, height: 100 });
    const rounded = frameObject('round', { width: 100, height: 100, cornerRadius: 500 });
    const sharpBounds = worldBoundsOf(square, transform);
    const roundedBounds = worldBoundsOf(rounded, transform);
    expect(roundedBounds).toBeDefined();
    expect(roundedBounds?.minX).toBeGreaterThan(sharpBounds?.minX ?? 0);
    expect(roundedBounds?.maxX).toBeLessThan(sharpBounds?.maxX ?? 0);
  });

  it('carries each corner radius through a clip chain and intersects nested rounded clips', () => {
    const objects = [
      frameObject('outer', { clip: true, width: 100, height: 100, cornerRadius: 30 }),
      frameObject('inner', {
        parentId: 'outer',
        clip: true,
        width: 100,
        height: 100,
        cornerRadius: [0, 20, 30, 40],
      }),
      shapeObject('leaf', { parentId: 'inner' }),
    ];
    const leaf = objects[2];
    const outer = objects[0];
    if (leaf === undefined || outer === undefined) throw new Error('Missing clip fixture');
    const chain = clipChainOf(leaf, sourceOf(objects));
    expect(chain).toMatchObject([{ cornerRadius: [0, 20, 30, 40] }, { cornerRadius: 30 }]);
    expect(isInsideClipChain({ x: 2, y: 2 }, chain)).toBe(false);
    expect(isInsideClipChain({ x: 50, y: 50 }, chain)).toBe(true);
    expect(clipChainOf(outer, sourceOf(objects))).toEqual([]);
  });
});
