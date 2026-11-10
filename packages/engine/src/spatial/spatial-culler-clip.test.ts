import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import type { InstanceRange } from '../scene/scene-culler.js';
import { Scene } from '../scene/scene.js';

import { SpatialCuller } from './spatial-culler.js';

const EVERYWHERE = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

function drawnSlots(ranges: ReadonlyMap<string, readonly InstanceRange[]>): number[] {
  return (ranges.get('solid-rect') ?? []).flatMap(({ start, count }) =>
    Array.from({ length: count }, (unused, offset) => start + offset),
  );
}

describe('SpatialCuller with clipping frames', () => {
  it('skips a clipped-away child even when every indexed object is visible', () => {
    const scene = new Scene([FILLED_RECT_PASS]);
    const culler = new SpatialCuller({ paddingFraction: 0, maxGapRecords: 0 });
    const document = new FakeSceneDocument();
    document.create(
      frameObject('p', { clip: true }),
      shapeObject('in', { parentId: 'p', x: 10, y: 10 }),
      shapeObject('out', { parentId: 'p', x: 500, y: 10 }),
      shapeObject('r', { x: 150 }),
    );
    const apply = () => {
      const changes = document.takeChanges();
      scene.apply(changes);
      culler.applyChanges(changes);
    };
    apply();
    const slotOf = (id: string) => scene.slotsOf(id as ObjectId, 'solid-rect')[0];
    const outSlot = slotOf('out');
    expect(outSlot).toBeDefined();
    expect(culler.index.clippedAwayCount).toBe(1);
    const drawn = drawnSlots(culler.cull(scene, EVERYWHERE));
    expect(drawn).not.toContain(outSlot);
    expect(drawn).toEqual(
      expect.arrayContaining([slotOf('p'), slotOf('in'), slotOf('r')].map(Number)),
    );
    expect(culler.visibleIdsFor(EVERYWHERE)).not.toContain('out');

    document.update('out', { x: 50 });
    apply();
    expect(drawnSlots(culler.cull(scene, EVERYWHERE))).toContain(outSlot);
    document.update('p', { width: 40 });
    apply();
    expect(drawnSlots(culler.cull(scene, EVERYWHERE))).not.toContain(outSlot);
  });
});
