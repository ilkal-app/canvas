import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '@canvas/schema';

import {
  applyCommand,
  expectRejected,
  mustGet,
} from '../commands/__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { bringToFrontCommand } from '../commands/reorder.js';
import { setLockedCommand } from '../commands/set-locked.js';
import { setStyleCommand } from '../commands/set-style.js';

import { readStoredEntry, writeStoredEntriesRemotely } from './__fixtures__/remote-values.js';
import {
  createFixtureStore,
  createSyncedPair,
  exchange,
  id,
} from './__fixtures__/store-fixtures.js';

// The board-wide bound applies to what commands do. Reading stays tolerant: a stored
// board that already holds an object past it (an older build, a peer that skips validation, a
// hostile client) still loads exactly as stored, nothing throws, the store never rewrites it, and
// a write that leaves its place alone (a lock, a reorder, a restyle, a delete) does not fail on
// it. Only a command that carries it further out is refused.

/**
 * A store whose `image-photo` was written, by a peer that skips validation, with `x` at 1e308.
 *
 * @returns The store.
 */
function storeWithFarImage(): ReturnType<typeof createFixtureStore> {
  const store = createFixtureStore();
  const placement = readStoredEntry(store, 'image-photo', 'placement') as object;
  writeStoredEntriesRemotely(store, 'image-photo', { placement: { ...placement, x: 1e308 } });
  return store;
}

describe('a stored object with a coordinate past the board bound', () => {
  it('loads as stored, and reading rewrites nothing', () => {
    const store = storeWithFarImage();
    const before = store.encodeState();
    const board = store.read();
    expect(board.issues).toEqual([]);
    expect(board.objects.get(id('image-photo'))).toMatchObject({ x: 1e308 });
    expect(store.get(id('image-photo'))).toMatchObject({ x: 1e308 });
    expect(store.encodeState()).toEqual(before);
  });

  it('loads a size, a line end, a vertex and a rotation past the bound the same way', () => {
    const store = createFixtureStore();
    writeStoredEntriesRemotely(store, 'sticky-idea', { size: { width: 1e308, height: 200 } });
    writeStoredEntriesRemotely(store, 'line-divider', { 'points.1': { x: 1e300, y: 0 } });
    const placement = readStoredEntry(store, 'video-demo', 'placement') as object;
    writeStoredEntriesRemotely(store, 'video-demo', {
      placement: { ...placement, rotation: 1e308 },
    });
    const board = store.read();
    expect(board.issues).toEqual([]);
    expect(board.objects.get(id('sticky-idea'))).toMatchObject({ width: 1e308 });
    expect(board.objects.get(id('video-demo'))).toMatchObject({ rotation: 1e308 });
    expect(mustGet(store, 'line-divider')).toMatchObject({ points: [{ x: 0 }, { x: 1e300 }] });
  });

  it('is left alone by a lock, a reorder, a restyle and a delete of a neighbour', () => {
    const store = storeWithFarImage();
    applyCommand(store, setLockedCommand, { ids: ['image-photo'], locked: true });
    applyCommand(store, setLockedCommand, { ids: ['image-photo'], locked: false });
    applyCommand(store, bringToFrontCommand, { ids: ['image-photo'] });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'image-photo', style: { opacity: 0.5 } }],
    });
    applyCommand(store, deleteObjectsCommand, { ids: ['video-demo'] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 1e308, opacity: 0.5, locked: false });
  });

  it('can be moved back into the bound, or deleted', () => {
    const store = storeWithFarImage();
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'image-photo', to: { x: 0, y: 0 } }] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: 0 });
    const other = storeWithFarImage();
    applyCommand(other, deleteObjectsCommand, { ids: ['image-photo'] });
    expect(other.get(id('image-photo'))).toBeUndefined();
  });

  it('takes a move that brings it in, and refuses one that carries it further out', () => {
    const store = storeWithFarImage();
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', to: { x: 2e300, y: 0 } }],
    });
    expect(mustGet(store, 'image-photo').x).toBe(2e300);
    const errors = expectRejected(store, moveObjectsCommand, {
      moves: [{ id: 'image-photo', to: { x: 1e301, y: 0 } }],
    });
    expect(errors.map(({ code }) => code)).toEqual(['invalid-input']);
    expect(BOARD_BOUND).toBeLessThan(1e308);
  });

  it('is the same on every peer, which converge on the same document', () => {
    const [first, second] = createSyncedPair();
    const placement = readStoredEntry(first, 'image-photo', 'placement') as object;
    writeStoredEntriesRemotely(first, 'image-photo', { placement: { ...placement, x: 1e308 } });
    exchange(first, second);
    applyCommand(second, bringToFrontCommand, { ids: ['image-photo'] });
    exchange(first, second);
    expect(second.encodeState()).toEqual(first.encodeState());
    expect(second.get(id('image-photo'))).toEqual(first.get(id('image-photo')));
  });
});
