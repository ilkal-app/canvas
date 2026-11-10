import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { nestedBoard } from './__fixtures__/nested-board.js';
import { isQueryReusable } from './padded-viewport.js';
import { SpatialCuller } from './spatial-culler.js';

/**
 * Makes a culler with no query padding and a row of indexed shapes.
 *
 * @param count - Number of shapes, 100 world units apart.
 * @returns The culler and its mutable document fixture.
 */
function row(count: number) {
  const document = new FakeSceneDocument();
  for (let index = 0; index < count; index += 1) {
    document.create(shapeObject(`s${String(index)}`, { x: index * 100, width: 10, height: 10 }));
  }
  const culler = new SpatialCuller({ paddingFraction: 0 });
  culler.applyChanges(document.takeChanges());
  return { culler, document };
}

/**
 * Makes a query rectangle across the row.
 *
 * @param minX - Left edge.
 * @param maxX - Right edge.
 * @returns The rectangle.
 */
function view(minX: number, maxX: number): WorldBounds {
  return { minX, maxX, minY: -5, maxY: 20 };
}

describe('incremental spatial visibility', () => {
  it('keeps the same visible snapshot without re-searching when both views contain the board', () => {
    const { culler } = row(10);
    const search = vi.spyOn(culler.index, 'searchRect');
    const first = culler.visibleIdsFor(view(-1000, 2000));
    expect(culler.visibleIdsFor(view(-1100, 1900))).toBe(first);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('reports only entering and leaving IDs and reuses the change across repeated stage reads', () => {
    const { culler } = row(3);
    const first = culler.visibilityFor(view(-5, 105));
    const next = culler.visibilityFor(view(95, 205));
    expect(next.previousRevision).toBe(first.revision);
    expect(next.entered).toEqual(['s2']);
    expect(next.left).toEqual(['s0']);
    expect(new Set(next.members)).toEqual(new Set(['s1', 's2']));
    expect(culler.visibilityFor(view(95, 205))).toBe(next);
  });

  it('applies indexed changes directly without searching unchanged query bounds', () => {
    const { culler, document } = row(3);
    culler.visibilityFor(view(-5, 105));
    const search = vi.spyOn(culler.index, 'searchRect');
    document.update('s1', { x: 400 });
    document.create(shapeObject('new', { x: 50, width: 10 }));
    culler.applyChanges(document.takeChanges());
    const changed = culler.visibilityFor(view(-5, 105));
    expect(changed.entered).toEqual(['new']);
    expect(changed.left).toEqual(['s1']);
    expect(search).not.toHaveBeenCalled();
  });

  it('matches fresh full queries across seeded pans, zooms, touching edges and object changes', () => {
    const { culler, document } = row(200);
    document.create(shapeObject('giant', { x: -1000, y: -1000, width: 24000, height: 3000 }));
    culler.applyChanges(document.takeChanges());
    let seed = 156;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let retained: WorldBounds | undefined;
    for (let step = 0; step < 300; step += 1) {
      if (step % 3 === 0) {
        const id = `s${String(step % 200)}`;
        document.update(id, { x: Math.floor(random() * 20000), width: random() * 400 });
        culler.applyChanges(document.takeChanges());
      }
      const minX = Math.floor(random() * 20000);
      const query = view(minX, minX + Math.floor(random() * 5000));
      if (!retained || !isQueryReusable(retained, query, 0)) retained = query;
      const changed = culler.visibilityFor(query);
      expect(new Set(changed.members)).toEqual(new Set(culler.index.searchRect(retained)));
      expect(new Set(culler.visibleIdsFor(query))).toEqual(new Set(changed.members));
      expect(new Set(changed.entered).size).toBe(changed.entered.length);
      expect(changed.left.some((id: ObjectId) => changed.members.has(id))).toBe(false);
    }
  });
  it('tracks nested moves, asynchronous bounds, deletion and same-frame leave/reenter', () => {
    const document = new FakeSceneDocument();
    for (const object of nestedBoard()) document.create(object);
    const culler = new SpatialCuller({ paddingFraction: 0 });
    culler.applyChanges(document.takeChanges());
    const query = { minX: 40, maxX: 105, minY: 100, maxY: 170 };
    const verify = () => {
      expect(new Set(culler.visibilityFor(query).members)).toEqual(
        new Set(culler.index.searchRect(query)),
      );
    };
    verify();
    document.update('f', { x: 500 });
    culler.applyChanges(document.takeChanges());
    verify();
    culler.setDrawingBounds('far' as ObjectId, query);
    verify();
    culler.setDrawingBounds('far' as ObjectId, undefined);
    verify();
    document.update('f', { x: 100 });
    culler.applyChanges(document.takeChanges());
    verify();
    const before = culler.visibilityFor(query);
    document.update('f', { x: 500 });
    culler.applyChanges(document.takeChanges());
    document.update('f', { x: 100 });
    culler.applyChanges(document.takeChanges());
    expect(culler.visibilityFor(query)).toBe(before);
    document.delete('g-b');
    culler.applyChanges(document.takeChanges());
    verify();
  });
});
