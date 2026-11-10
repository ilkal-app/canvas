import { expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { withRootMoveBatch } from '../scene/root-move-batch.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';

import { SceneSpatialIndex } from './scene-spatial-index.js';

it('uses scoped root objects without rereading them and preserves ordered bounds and queries', () => {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b', { rotation: 0.7, x: 30 }));
  const ordinary = new SceneSpatialIndex();
  const fast = new SceneSpatialIndex();
  const initial = document.takeChanges();
  ordinary.apply(initial);
  fast.apply(initial);
  const extra = { minX: -50, minY: -30, maxX: 100, maxY: 100 };
  ordinary.setDrawingBounds('a' as ObjectId, extra);
  fast.setDrawingBounds('a' as ObjectId, extra);
  document.update('a', { x: -0, y: 20 });
  document.update('b', { x: 42 });
  const raw = document.takeChanges();
  const objects = raw.updated.flatMap((id) => raw.get(id) ?? []);
  const get = vi.fn((key: ObjectId) => raw.get(key));
  const changes = markRootMoveChanges({ ...raw, get });
  const expected = ordinary.apply(raw);
  const actual = withRootMoveBatch(changes, objects, () => fast.apply(changes));
  expect([...actual]).toEqual([...expected]);
  expect(get).not.toHaveBeenCalled();
  expect(fast.searchRect(extra)).toEqual(ordinary.searchRect(extra));
  expect(fast.validate()).toEqual([]);
  get.mockClear();
  fast.apply(changes);
  expect(get).toHaveBeenCalled();
});

it.each(['child', 'unknown', 'parent', 'order', 'missing', 'unmarked'] as const)(
  'keeps ordinary traversal when batch preflight rejects %s',
  (kind) => {
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b', { x: 20 }));
    if (kind === 'child') document.create(shapeObject('child', { parentId: 'a', x: 5 }));
    if (kind === 'parent') document.update('b', { parentId: 'a' as ObjectId });
    const ordinary = new SceneSpatialIndex();
    const fast = new SceneSpatialIndex();
    const initial = document.takeChanges();
    ordinary.apply(initial);
    fast.apply(initial);
    if (kind === 'unknown') document.create(shapeObject('new'));
    document.update('a', { x: 30 });
    document.update('b', { x: 50 });
    const taken = document.takeChanges();
    const raw =
      kind === 'unknown'
        ? { ...taken, created: [], updated: [...taken.created, ...taken.updated] }
        : taken;
    const get = vi.fn((key: ObjectId) => raw.get(key));
    const changes = kind === 'unmarked' ? { ...raw, get } : markRootMoveChanges({ ...raw, get });
    const objects = [...raw.created, ...raw.updated].flatMap((id) => raw.get(id) ?? []);
    if (kind === 'order') objects.reverse();
    if (kind === 'missing') objects.pop();
    const expected = ordinary.apply(raw);
    const actual = withRootMoveBatch(changes, objects, () => fast.apply(changes));
    expect([...actual]).toEqual([...expected]);
    expect(get).toHaveBeenCalled();
    expect(fast.validate()).toEqual([]);
  },
);
