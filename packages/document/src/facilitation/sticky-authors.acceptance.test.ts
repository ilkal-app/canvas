import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { PrincipalId } from '@canvas/schema';

import { applyCommand, expectRejected } from '../commands/__fixtures__/command-fixtures.js';
import { findCommand } from '../commands/registry.js';
import { createHistory } from '../history/undo-manager.js';
import { setStickyAuthorsCommand, STICKY_AUTHORS_KEY, readStickyAuthors } from '../index.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

describe('sticky author board setting', () => {
  it('defaults to false and reads only a plain boolean from the facilitation map', () => {
    const map = new Y.Doc().getMap<unknown>('facilitation');
    expect(STICKY_AUTHORS_KEY).toBe('stickyAuthors');
    expect(readStickyAuthors(map)).toBe(false);
    for (const invalid of ['true', 1, null, { isShown: true }]) {
      map.set(STICKY_AUTHORS_KEY, invalid);
      expect(readStickyAuthors(map)).toBe(false);
    }
    map.set(STICKY_AUTHORS_KEY, true);
    expect(readStickyAuthors(map)).toBe(true);
    map.set(STICKY_AUTHORS_KEY, false);
    expect(readStickyAuthors(map)).toBe(false);
  });

  it('writes the board setting through a transaction and exposes it on the store', () => {
    const store = new YjsDocumentStore();
    expect(store.stickyAuthors.current).toBe(false);
    store.transact(ADA, (transaction) => {
      transaction.setStickyAuthors(true);
    });
    expect(store.stickyAuthors.current).toBe(true);
    store.transact(ADA, (transaction) => {
      transaction.setStickyAuthors(false);
    });
    expect(store.stickyAuthors.current).toBe(false);
  });

  it('registers a strict command, accepts the current value, and rejects malformed input', () => {
    const store = new YjsDocumentStore();
    expect(setStickyAuthorsCommand.name).toBe('setStickyAuthors');
    expect(findCommand('setStickyAuthors')).toBe(setStickyAuthorsCommand);
    applyCommand(store, setStickyAuthorsCommand, { isShown: true });
    expect(store.stickyAuthors.current).toBe(true);
    applyCommand(store, setStickyAuthorsCommand, { isShown: true });
    expect(store.stickyAuthors.current).toBe(true);
    for (const input of [
      { isShown: 'true' },
      { isShown: 1 },
      { isShown: null },
      { isShown: true, extra: 1 },
    ]) {
      expect(expectRejected(store, setStickyAuthorsCommand, input)).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'invalid-input' })]),
      );
    }
  });

  it('notifies only sticky author listeners when that key changes', () => {
    const store = new YjsDocumentStore();
    let authorCalls = 0;
    let timerCalls = 0;
    const stopAuthors = store.stickyAuthors.subscribe(() => (authorCalls += 1));
    const stopTimer = store.boardTimer.subscribe(() => {
      timerCalls += 1;
    });
    store.transact(ADA, (transaction) => {
      transaction.setStickyAuthors(true);
    });
    expect([authorCalls, timerCalls]).toEqual([1, 0]);
    store.transact(ADA, (transaction) => {
      transaction.setBoardTimer({
        status: 'idle',
        durationMs: 60_000,
        sectionId: null,
        updatedBy: 'user:ada' as PrincipalId,
      });
    });
    expect([authorCalls, timerCalls]).toEqual([1, 1]);
    stopAuthors();
    stopTimer();
    store.transact(ADA, (transaction) => {
      transaction.setStickyAuthors(false);
    });
    expect(authorCalls).toBe(1);
  });

  it('keeps setting changes outside undo and redo even around an object edit', () => {
    const store = createFixtureStore();
    const history = createHistory(store, 'user:ada' as PrincipalId);
    applyCommand(store, setStickyAuthorsCommand, { isShown: true });
    expect(history.canUndo()).toBe(false);
    const object = [...store.read().objects.values()][0];
    if (object === undefined) throw new Error('fixture needs an object');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...object, x: object.x + 10 });
    });
    history.stopCapturing();
    applyCommand(store, setStickyAuthorsCommand, { isShown: false });
    expect(history.undo()).toBe(true);
    expect(store.stickyAuthors.current).toBe(false);
    expect(history.redo()).toBe(true);
    expect(store.stickyAuthors.current).toBe(false);
    history.destroy();
  });
});
