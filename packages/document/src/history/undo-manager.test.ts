import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { groupCommand } from '../commands/group.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { setStyleCommand } from '../commands/set-style.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { ChangeSet, DocumentStore } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  ADA_ID,
  ADA_UNDO,
  BOB_ID,
  SCOUT_FOR_ADA,
  SCOUT_FOR_BOB,
} from './__fixtures__/history-fixtures.js';
import { createHistory, type UndoHistoryState } from './undo-manager.js';

/**
 * Moves the fixture's photo (a root object) by a delta, as a user would drag it.
 *
 * @param store - The store.
 * @param dx - The horizontal delta, board units.
 * @param origin - Who moves it; Ada by default.
 */
function nudgePhoto(store: DocumentStore, dx: number, origin = ADA): void {
  applyCommand(
    store,
    moveObjectsCommand,
    { moves: [{ id: 'image-photo', by: { x: dx, y: 0 } }] },
    origin,
  );
}

/**
 * Collects the change sets a store delivers.
 *
 * @param store - The store.
 * @returns The list, filled as change sets arrive.
 */
function collectChanges(store: DocumentStore): ChangeSet[] {
  const changes: ChangeSet[] = [];
  store.subscribe((changeSet) => changes.push(changeSet));
  return changes;
}

// These tests cover the history below the shell; tooling/scenario/specs/tools/select-transform.spec.ts
// drives undo and redo through the keyboard in the app (a drag-move, then mod+z and mod+shift+z).

describe('createHistory: undo and redo', () => {
  it('undoes a command back to the exact object, and redoes it', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const photo = fixtureObject('image-photo', 'image');
    nudgePhoto(store, 40);
    expect(history.undo()).toBe(true);
    expect(mustGet(store, 'image-photo')).toEqual(photo);
    expect(history.redo()).toBe(true);
    expect(mustGet(store, 'image-photo')).toEqual({ ...photo, x: photo.x + 40, updatedAt: NOW });
  });

  it('undoes a command that writes many objects as one step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const before = store.read().objects;
    applyCommand(store, groupCommand, { ids: ['image-photo', 'line-divider'] });
    expect(store.read().objects.size).toBe(before.size + 1);
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(new Map(store.read().objects)).toEqual(new Map(before));
  });

  it('restores deleted objects whole: text runs, labels and vector networks', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const before = new Map(store.read().objects);
    applyCommand(store, deleteObjectsCommand, {
      ids: [...store.references.childrenOf(null)],
    });
    expect(store.read().objects.size).toBe(0);
    history.undo();
    expect(new Map(store.read().objects)).toEqual(before);
    expect(store.read().issues).toEqual([]);
  });

  it('keeps one step per command, undone newest first', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const x = fixtureObject('image-photo', 'image').x;
    nudgePhoto(store, 1);
    nudgePhoto(store, 10);
    nudgePhoto(store, 100);
    history.undo();
    expect(mustGet(store, 'image-photo').x).toBe(x + 11);
    history.undo();
    expect(mustGet(store, 'image-photo').x).toBe(x + 1);
    history.undo();
    expect(mustGet(store, 'image-photo').x).toBe(x);
    expect(history.canUndo()).toBe(false);
  });

  it('delivers undo and redo change sets with an undo origin, so the app can label them', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 40);
    const changes = collectChanges(store);
    history.undo();
    history.redo();
    const expected = { origin: ADA_UNDO, isLocal: true, created: [], updated: [id('image-photo')] };
    expect(changes).toEqual([
      { ...expected, deleted: [] },
      { ...expected, deleted: [] },
    ]);
  });

  it('never captures its own undo steps as new steps: undo fills redo, redo fills undo', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 40);
    history.undo();
    expect([history.canUndo(), history.canRedo()]).toEqual([false, true]);
    history.redo();
    expect([history.canUndo(), history.canRedo()]).toEqual([true, false]);
    history.undo();
    history.redo();
    history.undo();
    expect(mustGet(store, 'image-photo')).toEqual(fixtureObject('image-photo', 'image'));
  });

  it('drops what could be redone when the user makes a new change', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 40);
    history.undo();
    nudgePhoto(store, 5);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it('writes nothing when there is nothing to undo or redo', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const state = store.encodeState();
    const changes = collectChanges(store);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
    expect(changes).toEqual([]);
    expect(store.encodeState()).toEqual(state);
  });
});

describe('createHistory: scoped by origin', () => {
  it('captures the commands of an agent the user operates, and undoes them', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 40, SCOUT_FOR_ADA);
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(mustGet(store, 'image-photo')).toEqual(fixtureObject('image-photo', 'image'));
  });

  it("ignores other users', their agents' and system changes on the same store", () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 40, BOB);
    nudgePhoto(store, 40, SCOUT_FOR_BOB);
    nudgePhoto(store, 40, SYSTEM_ORIGIN);
    expect(history.canUndo()).toBe(false);
  });

  it("gives two users on one store their own histories: each undo reverts only its user's change", () => {
    const store = createFixtureStore();
    const ada = createHistory(store, ADA_ID);
    const bob = createHistory(store, BOB_ID);
    const photo = fixtureObject('image-photo', 'image');
    nudgePhoto(store, 40);
    applyCommand(
      store,
      setStyleCommand,
      { changes: [{ id: 'image-photo', style: { opacity: 0.25 } }] },
      BOB,
    );
    ada.undo();
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: photo.x, opacity: 0.25 });
    expect(bob.canUndo()).toBe(true);
    bob.undo();
    expect(mustGet(store, 'image-photo')).toMatchObject({ x: photo.x, opacity: photo.opacity });
    expect([ada.canUndo(), bob.canUndo()]).toEqual([false, false]);
  });

  it("ignores remote updates, even when applied with the user's own origin", () => {
    const source = createFixtureStore();
    const target = new YjsDocumentStore();
    const history = createHistory(target, ADA_ID);
    target.applyUpdate(source.encodeState(), ADA);
    expect(history.canUndo()).toBe(false);
  });
});

describe('createHistory: state, capture window and lifetime', () => {
  it('tells subscribers when canUndo or canRedo changes, once per change', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    const states: UndoHistoryState[] = [];
    const unsubscribe = history.subscribe((state) => states.push(state));
    nudgePhoto(store, 1);
    nudgePhoto(store, 1);
    history.undo();
    history.undo();
    history.redo();
    unsubscribe();
    history.redo();
    expect(states).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: true, canRedo: true },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: true },
    ]);
  });

  it('merges changes inside a capture window into one step, and stopCapturing splits them', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID, { captureTimeout: 60_000 });
    const x = fixtureObject('image-photo', 'image').x;
    nudgePhoto(store, 1);
    nudgePhoto(store, 10);
    history.stopCapturing();
    nudgePhoto(store, 100);
    history.undo();
    expect(mustGet(store, 'image-photo').x).toBe(x + 11);
    history.undo();
    expect(mustGet(store, 'image-photo').x).toBe(x);
  });

  it('stops capturing when destroyed and refuses further use', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 1);
    history.destroy();
    history.destroy();
    expect(() => history.undo()).toThrow(/destroyed/);
    expect(() => history.canUndo()).toThrow(/destroyed/);
    nudgePhoto(store, 1);
    expect(createHistory(store, ADA_ID).canUndo()).toBe(false);
  });

  it('cannot undo from a store listener, like any write', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 1);
    const errors: unknown[] = [];
    store.subscribe(() => {
      try {
        history.undo();
      } catch (error) {
        errors.push(error);
      }
    });
    nudgePhoto(store, 1);
    expect(errors).toHaveLength(1);
    expect(history.canUndo()).toBe(true);
  });

  it("reports the transaction's error, not a subscriber's that follows it", () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA_ID);
    nudgePhoto(store, 1);
    store.subscribe(() => {
      throw new Error('store listener');
    });
    history.subscribe(() => {
      throw new Error('history listener');
    });
    expect(() => history.undo()).toThrow('store listener');
    expect(history.canRedo()).toBe(true);
  });

  it('refuses a principal that is not a person', () => {
    const store = new YjsDocumentStore();
    for (const principal of ['agent:scout', 'system', 'ada']) {
      expect(() => createHistory(store, principal as PrincipalId)).toThrow(RangeError);
    }
  });

  it('keeps a history for a guest and a demo board visitor', () => {
    const store = new YjsDocumentStore();
    for (const principal of ['guest:g-1', 'demo:v-1']) {
      expect(createHistory(store, principal as PrincipalId).canUndo()).toBe(false);
    }
  });

  it('refuses a negative or non-finite capture window', () => {
    const store = new YjsDocumentStore();
    for (const captureTimeout of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createHistory(store, ADA_ID, { captureTimeout })).toThrow(RangeError);
    }
  });

  it('refuses a store that has no Yjs document', () => {
    const impostor = Object.create(YjsDocumentStore.prototype) as DocumentStore;
    expect(() => createHistory(impostor, ADA_ID)).toThrow(TypeError);
  });
});
