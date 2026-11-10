import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { markRootMoveChanges } from '../scene/root-move-changes.js';

import { nestedBoard } from './__fixtures__/nested-board.js';
import { SceneSpatialIndex, type IndexedBoxChange } from './scene-spatial-index.js';

it('emits ordered descendant, removal and supplemented bounds after the complete update', () => {
  const document = new FakeSceneDocument();
  document.create(...nestedBoard());
  const ordinary = new SceneSpatialIndex();
  const observed = new SceneSpatialIndex();
  const initial = document.takeChanges();
  ordinary.apply(initial);
  observed.apply(initial);
  const extra = { minX: -200, minY: -200, maxX: 400, maxY: 400 };
  ordinary.setDrawingBounds('f-a' as ObjectId, extra);
  observed.setDrawingBounds('f-a' as ObjectId, extra);
  document.update('f', { x: 200 });
  document.delete('r');
  document.create(shapeObject('new', { x: 500 }));
  const changes = document.takeChanges();
  const expected = ordinary.apply(changes);
  const events: [ObjectId, IndexedBoxChange][] = [];
  observed.applyInto(changes, (id, previous, next) => {
    events.push([id, { previous, next }]);
    expect(observed.boundsOf('new' as ObjectId)).toEqual(ordinary.boundsOf('new' as ObjectId));
    expect(observed.boundsOf('r' as ObjectId)).toBeUndefined();
    expect(observed.searchRect(extra)).toEqual(ordinary.searchRect(extra));
  });
  expect(events).toEqual([...expected]);
  expect(observed.validate()).toEqual([]);
  const saved = structuredClone([...expected]);
  document.update('new', { x: 900 });
  ordinary.apply(document.takeChanges());
  expect([...expected]).toEqual(saved);
});

it('bulk loads before callbacks and keeps outer events stable during reentrant updates', () => {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b', { x: 20 }));
  const index = new SceneSpatialIndex();
  const events: [ObjectId, IndexedBoxChange][] = [];
  index.applyInto(document.takeChanges(), (id, previous, next) => {
    events.push([id, { previous, next }]);
    if (id === 'a') {
      expect(index.size).toBe(2);
      document.update('b', { x: 100 });
      index.apply(document.takeChanges());
    }
  });
  expect(events.map(([id]) => id)).toEqual(['a', 'b']);
  expect(events[1]?.[1].next?.minX).toBe(20);
  expect(index.boundsOf('b' as ObjectId)?.minX).toBe(100);
});

it('does not delete indexed entries before all source bounds have been read', () => {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b'));
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  const before = index.boundsOf('a' as ObjectId);
  const changes = markRootMoveChanges({
    created: [],
    updated: ['a', 'b'] as ObjectId[],
    deleted: [],
    get: (id: ObjectId) => {
      if (id === 'b') throw new Error('source failed');
      return undefined;
    },
  });
  expect(() => {
    index.applyInto(changes, () => undefined);
  }).toThrow('source failed');
  expect(index.boundsOf('a' as ObjectId)).toEqual(before);
  expect(index.size).toBe(2);
});
