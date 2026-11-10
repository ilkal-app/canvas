import { expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from './__fixtures__/scene-objects.js';
import { withRootMoveBatch } from './root-move-batch.js';
import { markRootMoveChanges } from './root-move-changes.js';
import type { SceneObject } from './scene-pass.js';
import type { SceneChangeSet } from './scene-source.js';
import { Scene } from './scene.js';

function fixture() {
  const document = new FakeSceneDocument();
  const ordinary = new Scene([FILLED_RECT_PASS]);
  const batch = new Scene([FILLED_RECT_PASS]);
  document.create(shapeObject('a', { rotation: -0.371 }), shapeObject('b'));
  const initial = document.takeChanges();
  ordinary.apply(initial);
  batch.apply(initial);
  return { document, ordinary, batch };
}

function objectsOf(changes: SceneChangeSet): BoardObject[] {
  return changes.updated.map((id) => {
    const object = changes.get(id);
    if (!object) throw new Error('fixture member missing');
    return object;
  });
}

it('avoids unchanged parent writes while preserving exact retained targets and counts', () => {
  const { document, ordinary, batch } = fixture();
  const expected: SceneObject[] = [];
  const actual: SceneObject[] = [];
  ordinary.useRetainedMove((target) => {
    expected.push(target);
    return true;
  });
  batch.useRetainedMove((target) => {
    actual.push(target);
    return true;
  });
  document.update('a', { x: -0, y: 16_777_217.125 });
  document.update('b', { x: 31.333333333, y: -22.125 });
  const changes = markRootMoveChanges(document.takeChanges());
  const objects = objectsOf(changes);
  expect(ordinary.apply(changes)).toBe(2);
  const writes = vi.spyOn(Map.prototype, 'set');
  let written = 0;
  let count = 0;
  withRootMoveBatch(changes, objects, () => {
    writes.mockClear();
    count = batch.apply(changes);
    written = writes.mock.calls.length;
  });
  writes.mockRestore();
  expect(count).toBe(2);
  expect(written).toBe(0);
  expect(actual).toEqual(expected);
  expect(Object.is(actual[0]?.transform.x, -0)).toBe(true);
  expect(batch.objectCount).toBe(2);
  expect(batch.slotOwnershipRevision).toBe(ordinary.slotOwnershipRevision);
  expect(batch.instanceBufferOf(FILLED_RECT_PASS.name).data).toEqual(
    ordinary.instanceBufferOf(FILLED_RECT_PASS.name).data,
  );
});

it('keeps record fallback bytes and later ordinary deletion/recreation identical', () => {
  const { document, ordinary, batch } = fixture();
  for (const scene of [ordinary, batch]) scene.useRetainedMove(({ object }) => object.id === 'a');
  document.update('a', { x: 41.125 });
  document.update('b', { x: 99.9999999, y: -0 });
  const changes = markRootMoveChanges(document.takeChanges());
  expect(withRootMoveBatch(changes, objectsOf(changes), () => batch.apply(changes))).toBe(
    ordinary.apply(changes),
  );
  const compare = () => {
    const left = ordinary.instanceBufferOf(FILLED_RECT_PASS.name);
    const right = batch.instanceBufferOf(FILLED_RECT_PASS.name);
    expect(right.data).toEqual(left.data);
    expect(right.dirtyRanges).toEqual(left.dirtyRanges);
    expect(batch.objectCount).toBe(ordinary.objectCount);
    expect(batch.slotOwnershipRevision).toBe(ordinary.slotOwnershipRevision);
  };
  compare();
  for (const scene of [ordinary, batch]) scene.useRetainedMove(undefined);
  document.delete('a');
  const deleted = document.takeChanges();
  ordinary.apply(deleted);
  batch.apply(deleted);
  compare();
  document.create(shapeObject('a', { x: 200 }));
  const created = document.takeChanges();
  ordinary.apply(created);
  batch.apply(created);
  compare();
});

it.each([
  'unknown',
  'nonroot',
  'child',
  'missing',
  'order',
  'length',
  'inactive',
  'unmarked',
  'newparent',
  'frame',
  'group',
  'created',
  'deleted',
])('refuses the entire %s batch before invoking any retained callback', (kind) => {
  const { document, ordinary, batch } = fixture();
  if (kind === 'nonroot') document.update('b', { parentId: 'a' as ObjectId });
  if (kind === 'child') document.create(shapeObject('child', { parentId: 'b' }));
  const initial = document.takeChanges();
  ordinary.apply(initial);
  batch.apply(initial);
  const expected: SceneObject[] = [];
  const actual: SceneObject[] = [];
  if (kind !== 'inactive') {
    ordinary.useRetainedMove((target) => {
      expected.push(target);
      return false;
    });
    batch.useRetainedMove((target) => {
      actual.push(target);
      return false;
    });
  }
  document.update('a', { x: 200 });
  document.update('b', { x: 300 });
  if (kind === 'created') document.create(shapeObject('created'));
  if (kind === 'deleted') document.delete('absent');
  const changes = document.takeChanges();
  if (kind !== 'unmarked') markRootMoveChanges(changes);
  const objects = objectsOf(changes);
  objects[0] = shapeObject('a', { x: 100 });
  if (kind === 'unknown') objects[1] = shapeObject('unknown');
  if (kind === 'missing') {
    const removal = {
      created: [],
      updated: [],
      deleted: ['b' as ObjectId],
      get: () => undefined,
    };
    ordinary.apply(removal);
    batch.apply(removal);
  }
  if (kind === 'newparent') objects[1] = shapeObject('b', { parentId: 'a' });
  if (kind === 'frame') objects[1] = frameObject('b');
  if (kind === 'group') objects[1] = groupObject('b');
  if (kind === 'order') objects.reverse();
  if (kind === 'length') objects.pop();
  const expectedCount = ordinary.apply(changes);
  const count = withRootMoveBatch(changes, objects, () => batch.apply(changes));
  expect(count).toBe(expectedCount);
  expect(actual).toEqual(expected);
  expect(batch.instanceBufferOf(FILLED_RECT_PASS.name).data).toEqual(
    ordinary.instanceBufferOf(FILLED_RECT_PASS.name).data,
  );
  expect(batch.objectCount).toBe(ordinary.objectCount);
});
