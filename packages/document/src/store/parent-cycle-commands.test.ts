// Commands on a store holding a parent cycle that no repair has written: a local raw
// write is not repaired (only updates and undo are).
// Commands read the board as the store shows it, the cycle broken at its lowest id, so they
// act where the person sees the objects; a move of the re-rooted member writes its shown parent
// with its new position, which ends the stored cycle.
import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from '../commands/__fixtures__/nested-frames.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { runCommand } from '../commands/run-command.js';
import { hostileUpdate, worldOf } from '../repair/__fixtures__/cycle-fixtures.js';

import { ADA, id, RELAY } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

/**
 * The nested-frames board with frame-outer and frame-side written into each other.
 *
 * @returns The store.
 */
function loopedStore(): YjsDocumentStore {
  const store = createNestedFramesStore();
  store.transact(ADA, (transaction) => {
    transaction.patchObject(id('frame-outer'), { parentId: id('frame-side') });
    transaction.patchObject(id('frame-side'), { parentId: id('frame-outer') });
  });
  return store;
}

describe('commands on a stored parent cycle the store shows broken', () => {
  it('move the re-rooted member from where it is shown, writing its shown parent', () => {
    const store = loopedStore();
    const shown = mustGet(store, 'frame-outer');
    expect(shown.parentId).toBeNull();
    const [, , x, y] = worldOf(store.read(), 'frame-outer');
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'frame-outer', by: { x: 10, y: 5 } }],
    });
    const moved = mustGet(store, 'frame-outer');
    expect(moved.parentId).toBeNull();
    expect([moved.x, moved.y]).toEqual([(x ?? 0) + 10, (y ?? 0) + 5]);
    expect(store.read().issues).toEqual([]);
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('move a member’s contents by what the person sees', () => {
    const store = loopedStore();
    const before = worldOf(store.read(), 'rect-side');
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'rect-side', by: { x: 10, y: 5 } }] });
    const after = worldOf(store.read(), 'rect-side');
    expect([after[2], after[3]]).toEqual([(before[2] ?? 0) + 10, (before[3] ?? 0) + 5]);
    expect(mustGet(store, 'rect-side').parentId).toBe('frame-side');
  });

  it.each(['raw'] as const)(
    'moving another member of a %s cycle leaves the displayed root in place',
    () => {
      const store = loopedStore();
      const root = worldOf(store.read(), 'frame-outer');
      const moving = worldOf(store.read(), 'frame-side');
      applyCommand(store, moveObjectsCommand, {
        moves: [{ id: 'frame-side', by: { x: 10, y: 5 } }],
      });
      expect(worldOf(store.read(), 'frame-outer')).toEqual(root);
      expect(mustGet(store, 'frame-outer').updatedAt).toBe(mustGet(store, 'frame-side').updatedAt);
      const after = worldOf(store.read(), 'frame-side');
      expect([after[2], after[3]]).toEqual([(moving[2] ?? 0) + 10, (moving[3] ?? 0) + 5]);
      const cold = new YjsDocumentStore();
      cold.applyUpdate(store.encodeState(), RELAY);
      expect(new Map(cold.read().objects)).toEqual(new Map(store.read().objects));
      cold.destroy();
      store.destroy();
    },
  );
  it('moves another member when the root a peer left invalid is repaired around its width', () => {
    // The repair writes the root's placement only, so the width a peer left invalid no
    // longer refuses it, nor the move after it.
    const store = createNestedFramesStore();
    store.applyUpdate(
      hostileUpdate(store, {
        'frame-outer': { placement: { parentId: 'frame-side' }, size: { width: -1 } },
        'frame-side': { placement: { parentId: 'frame-outer' } },
      }),
      RELAY,
    );
    expect(mustGet(store, 'frame-outer')).toMatchObject({ parentId: null, width: -1 });
    const result = runCommand(
      store,
      ADA,
      moveObjectsCommand,
      {
        moves: [
          { id: 'rect-free', by: { x: 30, y: 10 } },
          { id: 'frame-side', by: { x: 10, y: 5 } },
        ],
      },
      { clock: () => 1760001000000, createId: () => id('unused') },
    );
    expect(result.status).toBe('applied');
    expect(mustGet(store, 'frame-outer')).toMatchObject({ parentId: null, width: -1 });
    store.destroy();
  });
  it('keeps deletion available for another member when a peer left the root invalid', () => {
    const store = createNestedFramesStore();
    store.applyUpdate(
      hostileUpdate(store, {
        'frame-outer': { placement: { parentId: 'frame-side' }, size: { width: -1 } },
        'frame-side': { placement: { parentId: 'frame-outer' } },
      }),
      RELAY,
    );
    applyCommand(store, deleteObjectsCommand, { ids: ['frame-side'] });
    expect(store.get(id('frame-side'))).toBeUndefined();
    expect(store.get(id('frame-outer'))).toBeDefined();
    store.destroy();
  });
});
