import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { SceneChangeQueue } from './scene-change-queue.js';
import type { SceneChangeSet } from './scene-source.js';

const ids = (...names: string[]): ObjectId[] => names as ObjectId[];

function changeSet(
  created: string[],
  updated: string[],
  deleted: string[],
  get: (id: ObjectId) => BoardObject | undefined = () => undefined,
): SceneChangeSet {
  return { created: ids(...created), updated: ids(...updated), deleted: ids(...deleted), get };
}

describe('SceneChangeQueue', () => {
  it('drains nothing when no change set was pushed', () => {
    const queue = new SceneChangeQueue();
    expect(queue.size).toBe(0);
    expect(queue.drain()).toBeUndefined();
  });

  it('drains a single change set as it was pushed', () => {
    const queue = new SceneChangeQueue();
    const only = changeSet(['a'], ['b'], ['c']);
    queue.push(only);
    expect(queue.drain()).toBe(only);
    expect(queue.size).toBe(0);
  });

  it('coalesces the change sets pushed between frames into one, ids deduplicated', () => {
    const queue = new SceneChangeQueue();
    queue.push(changeSet(['a'], ['b'], []));
    queue.push(changeSet(['c'], ['b', 'a'], ['d']));
    const drained = queue.drain();
    expect(drained?.created).toEqual(['a', 'c']);
    expect(drained?.updated).toEqual(['b', 'a']);
    expect(drained?.deleted).toEqual(['d']);
    expect(queue.drain()).toBeUndefined();
  });

  it('reads the coalesced objects through the latest change set, the document as it is now', () => {
    const queue = new SceneChangeQueue();
    const stale = { id: 'a' } as BoardObject;
    const current = { id: 'a' } as BoardObject;
    queue.push(changeSet(['a'], [], [], () => stale));
    queue.push(changeSet([], ['a'], [], () => current));
    expect(queue.drain()?.get('a' as ObjectId)).toBe(current);
  });
});
