import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { SpatialCuller } from './spatial-culler.js';
import { SpatialVisibility } from './spatial-visibility.js';

const VIEW: WorldBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
const QUERY: WorldBounds = { minX: -50, minY: -50, maxX: 150, maxY: 150 };

function distance(x: number, y: number): number {
  const dx = Math.max(0, x - 50, 50 - (x + 4));
  const dy = Math.max(0, y - 50, 50 - (y + 4));
  return Math.max(dx / 50, dy / 50);
}

function grid() {
  const document = new FakeSceneDocument();
  const positions = new Map<ObjectId, readonly [number, number]>();
  // Far corners are indexed first, so index iteration cannot accidentally satisfy centre first.
  for (let y = 140; y >= -40; y -= 10) {
    for (let x = 140; x >= -40; x -= 10) {
      const id = `rect-${String(x)}-${String(y)}` as ObjectId;
      document.create(shapeObject(id, { x, y, width: 4, height: 4 }));
      positions.set(id, [x, y]);
    }
  }
  const index = new SpatialCuller().index;
  index.apply(document.takeChanges());
  return { index, positions };
}

describe('centre-first budgeted admissions', () => {
  it.each([1, 7, 100])('admits the grid by eighth-width rings with budget %i', (limit) => {
    const { index, positions } = grid();
    const visibility = new SpatialVisibility();
    const reference = new SpatialVisibility();
    const desired = new Set(reference.update(index, QUERY, []).members);
    const admitted: ObjectId[] = [];
    for (let frame = 0; frame < Math.ceil(desired.size / limit); frame += 1) {
      const change = visibility.update(index, QUERY, [], {
        entriesPerFrame: limit,
        viewport: VIEW,
      });
      expect(change.entered.length).toBeLessThanOrEqual(limit);
      admitted.push(...change.entered);
    }
    expect(visibility.pendingCount).toBe(0);
    expect(visibility.update(index, QUERY, []).members).toEqual(desired);
    const distances = admitted.map((id) => {
      const [x, y] = positions.get(id) ?? [NaN, NaN];
      return distance(x, y);
    });
    let hasReachedPadding = false;
    let farthest = 0;
    for (const current of distances) {
      if (current > 1) hasReachedPadding = true;
      if (hasReachedPadding) expect(current).toBeGreaterThan(1);
      // No entry comes after one more than a ring (1/8) farther from the centre.
      expect(current).toBeGreaterThanOrEqual(farthest - 1 / 8);
      farthest = Math.max(farthest, current);
    }
  });

  it('takes an older carried entry before a nearer new entry', () => {
    const document = new FakeSceneDocument();
    document.create(shapeObject('far', { x: 95, y: 95, width: 4, height: 4 }));
    document.create(shapeObject('other', { x: 90, y: 90, width: 4, height: 4 }));
    const index = new SpatialCuller().index;
    index.apply(document.takeChanges());
    const visibility = new SpatialVisibility();
    visibility.update(index, QUERY, [], { entriesPerFrame: 1, viewport: VIEW });
    document.create(shapeObject('near', { x: 48, y: 48, width: 4, height: 4 }));
    index.apply(document.takeChanges());
    const second = visibility.update(index, QUERY, ['near' as ObjectId], {
      entriesPerFrame: 1,
      viewport: VIEW,
    });
    expect(second.entered).toEqual(['far']);
    expect(second.left).toEqual([]);
    const third = visibility.update(index, QUERY, [], { entriesPerFrame: 1, viewport: VIEW });
    expect(third.entered).toEqual(['near']);
    expect(visibility.pendingCount).toBe(0);
  });

  it('admits a new entry before an exit discovered in the same update', () => {
    const document = new FakeSceneDocument();
    document.create(shapeObject('leaving', { x: -80, y: -80, width: 4, height: 4 }));
    document.create(shapeObject('entering', { x: 48, y: 48, width: 4, height: 4 }));
    const index = new SpatialCuller().index;
    index.apply(document.takeChanges());
    const visibility = new SpatialVisibility();
    visibility.update(index, { minX: -100, minY: -100, maxX: -70, maxY: -70 }, []);
    const first = visibility.update(index, QUERY, [], { entriesPerFrame: 1, viewport: VIEW });
    expect(first.entered).toEqual(['entering']);
    expect(first.left).toEqual([]);
    const second = visibility.update(index, QUERY, [], { entriesPerFrame: 1, viewport: VIEW });
    expect(second.left).toEqual(['leaving']);
  });
});
