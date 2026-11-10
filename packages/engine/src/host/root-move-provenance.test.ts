import { expect, it } from 'vitest';

import { shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { isRootMoveChanges } from '../scene/root-move-changes.js';
import { SceneChangeQueue } from '../scene/scene-change-queue.js';

import { SceneSourceMirror } from './scene-source-mirror.js';

it('proves only accepted update commands, losing the proof across ordinary or session changes', () => {
  const mirror = new SceneSourceMirror();
  const object = shapeObject('a');
  const begin = mirror.applyMove({
    kind: 'begin',
    session: 1,
    sequence: 0,
    objects: [object],
    positions: new Float64Array([1, 2]),
  });
  if (!begin) throw new Error('Expected begin');
  expect(isRootMoveChanges(begin)).toBe(false);
  const update = mirror.applyMove({
    kind: 'update',
    session: 1,
    sequence: 1,
    positions: new Float64Array([2, 3]),
  });
  if (!update) throw new Error('Expected update');
  expect(isRootMoveChanges(update)).toBe(true);
  expect(isRootMoveChanges({ ...update })).toBe(false);
  const queue = new SceneChangeQueue();
  queue.push(update);
  queue.push(update);
  const pure = queue.drain();
  if (!pure) throw new Error('Expected merged changes');
  expect(isRootMoveChanges(pure)).toBe(true);
  queue.push(update);
  queue.push(begin);
  const mixed = queue.drain();
  if (!mixed) throw new Error('Expected merged changes');
  expect(isRootMoveChanges(mixed)).toBe(false);
  const end = mirror.applyMove({ kind: 'end', session: 1, sequence: 2 });
  if (!end) throw new Error('Expected end');
  expect(isRootMoveChanges(end)).toBe(false);
});
