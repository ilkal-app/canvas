import { describe, expect, it } from 'vitest';

import { createHistory, YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PrincipalId, StickyObject } from '@canvas/schema';

import { toggleStickyAuthors } from './sticky-authors-toggle.js';

describe('toggleStickyAuthors', () => {
  it('flips the shared setting on each press without entering the person’s undo history', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, 'user:ada' as PrincipalId);

    toggleStickyAuthors(store);
    expect(store.stickyAuthors.current).toBe(true);
    expect(history.canUndo()).toBe(false);

    const note: StickyObject = {
      id: 'note-1' as ObjectId,
      type: 'sticky',
      parentId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: 'user:ada' as PrincipalId,
      createdAt: 1,
      updatedAt: 1,
      text: 'Note',
      runs: [
        {
          length: 4,
          style: {
            fontFamily: 'Inter',
            fontSize: 16,
            color: [0, 0, 0, 1],
            weight: 400,
            italic: false,
          },
        },
      ],
      align: 'left',
      verticalAlign: 'top',
      color: [1, 1, 0, 1],
      autoWidth: false,
    };
    store.transact({ kind: 'user', principalId: 'user:ada' as PrincipalId }, (transaction) => {
      transaction.setObject(note);
    });
    history.stopCapturing();
    toggleStickyAuthors(store);
    expect(store.stickyAuthors.current).toBe(false);
    expect(history.undo()).toBe(true);
    expect(store.stickyAuthors.current).toBe(false);
    history.destroy();
  });
});
