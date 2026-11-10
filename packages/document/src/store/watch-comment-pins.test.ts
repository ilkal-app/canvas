import { describe, expect, it } from 'vitest';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import type { NewObject } from '../commands/new-object-schema.js';
import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';

import {
  ADA,
  BOB,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
  RELAY,
} from './__fixtures__/store-fixtures.js';
import {
  syncCommentThreads,
  watchCommentPins,
  type CommentPinChanges,
} from './watch-comment-pins.js';

/**
 * A synced pair of fixture stores (two comment pins: `comment-free` on `thread-free`,
 * `comment-on-photo` on `thread-photo`), the first one watched.
 *
 * @returns The stores, what the watcher told, and its stop.
 */
function watched() {
  const [store, peer] = createSyncedPair();
  const told: CommentPinChanges[] = [];
  const stop = watchCommentPins(store, (changes) => told.push(changes));
  return { store, peer, told, stop };
}

describe('watchCommentPins', () => {
  it('tells the thread whose pin the client deleted, once per transaction', () => {
    const { store, told } = watched();
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-free')] });
    expect(told).toEqual([{ deleted: ['thread-free'], restored: [] }]);
  });

  it('tells every thread of a delete that takes several pins', () => {
    const { store, told } = watched();
    applyCommand(store, deleteObjectsCommand, {
      ids: [id('comment-free'), id('comment-on-photo')],
    });
    expect(told).toHaveLength(1);
    expect([...(told[0]?.deleted ?? [])].sort()).toEqual(['thread-free', 'thread-photo']);
  });

  it('tells nothing when the anchor object goes and the pin becomes a point pin', () => {
    const { store, told } = watched();
    applyCommand(store, deleteObjectsCommand, { ids: [id('image-photo')] });
    expect(store.get(id('comment-on-photo'))?.type).toBe('comment');
    expect(told).toEqual([]);
  });

  it("tells nothing for a peer's delete or a system repair", () => {
    const { store, peer, told } = watched();
    applyCommand(peer, deleteObjectsCommand, { ids: [id('comment-free')] }, BOB);
    exchange(store, peer);
    expect(store.get(id('comment-free'))).toBeUndefined();
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-on-photo')] }, RELAY);
    expect(told).toEqual([]);
  });

  it('tells the restore when undo brings the pin back, and the delete again on redo', () => {
    const { store, told } = watched();
    const history = createHistory(store, ADA_ID);
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-free')] });
    history.undo();
    expect(store.get(id('comment-free'))?.type).toBe('comment');
    history.redo();
    expect(told).toEqual([
      { deleted: ['thread-free'], restored: [] },
      { deleted: [], restored: ['thread-free'] },
      { deleted: ['thread-free'], restored: [] },
    ]);
    history.destroy();
  });

  it('tells nothing while another pin keeps the thread, and nothing for a new pin', () => {
    const { store, told } = watched();
    applyCommand(
      store,
      createObjectCommand,
      {
        object: {
          type: 'comment',
          id: id('comment-second'),
          x: 10,
          y: 10,
          threadId: 'thread-free',
          anchor: { kind: 'point' },
        },
      },
      ADA,
    );
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-free')] });
    expect(told).toEqual([]);
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-second')] });
    expect(told).toEqual([{ deleted: ['thread-free'], restored: [] }]);
  });

  it('tells nothing for a change to an object that is no pin', () => {
    const { store, told } = watched();
    // A new object carries no stamps: the command writes them.
    const stamps = new Set(['createdBy', 'createdAt', 'updatedAt']);
    const sticky = Object.fromEntries(
      Object.entries(fixtureObject('sticky-idea', 'sticky')).filter(([key]) => !stamps.has(key)),
    );
    applyCommand(store, createObjectCommand, {
      object: { ...sticky, id: id('sticky-copy'), parentId: null } as NewObject,
    });
    applyCommand(store, deleteObjectsCommand, { ids: [id('sticky-copy')] });
    expect(told).toEqual([]);
  });

  it('tells nothing once stopped', () => {
    const { store, told, stop } = watched();
    stop();
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-free')] });
    expect(told).toEqual([]);
  });
});

describe('syncCommentThreads', () => {
  it("runs one thread's delete and the undo's restore in order, however slow the delete", async () => {
    const [store] = createSyncedPair();
    const history = createHistory(store, ADA_ID);
    const log: string[] = [];
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settledWith: unknown[] = [];
    const sync = syncCommentThreads(
      store,
      {
        deleteThread: async (threadId) => {
          log.push(`delete ${threadId} start`);
          await slow;
          log.push(`delete ${threadId} end`);
        },
        restoreThread: (threadId) => {
          log.push(`restore ${threadId}`);
          return Promise.reject(new Error('offline'));
        },
      },
      (error) => settledWith.push(error),
    );
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-free')] });
    history.undo();
    await Promise.resolve();
    expect(log).toEqual(['delete thread-free start']);
    release();
    await sync.settled();
    expect(log).toEqual([
      'delete thread-free start',
      'delete thread-free end',
      'restore thread-free',
    ]);
    expect(settledWith).toEqual([undefined, new Error('offline')]);
    sync.stop();
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-on-photo')] });
    await sync.settled();
    expect(log).toHaveLength(3);
    history.destroy();
  });

  it("runs different threads' writes side by side", async () => {
    const [store] = createSyncedPair();
    const started: string[] = [];
    const sync = syncCommentThreads(store, {
      deleteThread: (threadId) => {
        started.push(threadId);
        return new Promise(() => undefined);
      },
      restoreThread: () => Promise.resolve(),
    });
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-free')] });
    applyCommand(store, deleteObjectsCommand, { ids: [id('comment-on-photo')] });
    await Promise.resolve();
    expect(started).toEqual(['thread-free', 'thread-photo']);
    sync.stop();
  });
});
