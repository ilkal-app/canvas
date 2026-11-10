import { describe, expect, it } from 'vitest';

import { BOB, createSyncedPair, exchange } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from './move-objects.js';
import { runCommand } from './run-command.js';
import { setLockedCommand } from './set-locked.js';

// Sync tests for `setLocked`: a lock is its own key in the grouped
// layout (`locked`), so it merges with a concurrent move of the same object. A move validated
// before the lock arrives lands whole; one attempted after it is refused whole. Neither is ever
// half-applied.

/**
 * Checks that both clients hold the same, valid board.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(ada.read().issues).toEqual([]);
}

/**
 * Where an object sits in its parent.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @returns Its `x` and `y`.
 */
function placeOf(store: YjsDocumentStore, objectId: string): { x: number; y: number } {
  const { x, y } = mustGet(store, objectId);
  return { x, y };
}

describe('concurrent lock and move', () => {
  it('keeps a move made before the lock arrived, whole, and the lock with it', () => {
    const [ada, bob] = createSyncedPair();
    // Both at the root, so a board delta is a delta of `x` and `y`.
    const photo = placeOf(ada, 'image-photo');
    const video = placeOf(ada, 'video-demo');
    applyCommand(ada, setLockedCommand, { ids: ['image-photo'], locked: true });
    applyCommand(
      bob,
      moveObjectsCommand,
      {
        moves: [
          { id: 'image-photo', by: { x: 40, y: 0 } },
          { id: 'video-demo', by: { x: 40, y: 0 } },
        ],
      },
      BOB,
    );
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(ada, 'image-photo').locked).toBe(true);
    expect(placeOf(ada, 'image-photo')).toEqual({ x: photo.x + 40, y: photo.y });
    expect(placeOf(ada, 'video-demo')).toEqual({ x: video.x + 40, y: video.y });
  });

  it('refuses a move of a locked object whole once the lock has arrived', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, setLockedCommand, { ids: ['image-photo'], locked: true });
    exchange(ada, bob);
    const before = bob.encodeState();
    const outcome = runCommand(
      bob,
      BOB,
      moveObjectsCommand,
      {
        moves: [
          { id: 'image-photo', by: { x: 40, y: 0 } },
          { id: 'video-demo', by: { x: 40, y: 0 } },
        ],
      },
      testEnvironment(11),
    );
    expect(outcome.status).toBe('rejected');
    expect(outcome.status === 'rejected' && outcome.errors.map(({ code }) => code)).toEqual([
      'locked',
    ]);
    expect(bob.encodeState()).toEqual(before);
    exchange(ada, bob);
    expectConverged(ada, bob);
  });
});

describe('concurrent lock and unlock', () => {
  it('converge on one value when one client locks what another unlocks', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, setLockedCommand, { ids: ['shape-star', 'shape-box'], locked: true });
    applyCommand(bob, setLockedCommand, { ids: ['shape-star'], locked: false }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(typeof mustGet(ada, 'shape-star').locked).toBe('boolean');
    expect(mustGet(bob, 'shape-box').locked).toBe(true);
  });

  it('converge when both clients lock the same objects', () => {
    const [ada, bob] = createSyncedPair();
    applyCommand(ada, setLockedCommand, { ids: ['shape-box', 'image-photo'], locked: true });
    applyCommand(bob, setLockedCommand, { ids: ['image-photo'], locked: true }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(mustGet(ada, 'image-photo').locked).toBe(true);
    expect(mustGet(ada, 'shape-box').locked).toBe(true);
  });
});
