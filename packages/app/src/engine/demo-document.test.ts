import { describe, expect, it } from 'vitest';

import { compareKeys, createHistory, YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createDemoBoard } from './demo-board.js';
import { createDemoDocument, LOCAL_USER_ORIGIN, writeBoard } from './demo-document.js';

describe('createDemoDocument', () => {
  it('holds the demo board, object for object, as the product wrote it', () => {
    const store = createDemoDocument();
    const board = createDemoBoard();
    expect(store.read().objects.size).toBe(board.length);
    for (const object of board) {
      expect(store.get(object.id)).toEqual({
        ...object,
        pageId: object.parentId === null ? 'page-1' : null,
        createdBy: 'system',
        z: expect.any(String) as string,
      });
    }
    expect(store.read().issues).toEqual([]);
  });

  it('stacks each section’s rectangles in the order they were created', () => {
    const store = createDemoDocument();
    const keys = [...store.references.childrenOf('section-0' as ObjectId)]
      .map((id) => store.get(id))
      .sort((first, second) => compareKeys(first?.z ?? '', second?.z ?? ''))
      .map((object) => object?.id);
    expect(keys.slice(0, 2)).toEqual(['section-0-rect-0-0', 'section-0-rect-1-0']);
  });

  it('is the product’s own change, which the local user’s undo never reverts', () => {
    const store = createDemoDocument();
    const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
    expect(history.undo()).toBe(false);
    expect(store.read().objects.size).toBe(createDemoBoard().length);
  });

  it('refuses a board with an object the schema rejects', () => {
    const frame = createDemoBoard()[0];
    if (frame === undefined) throw new Error('the demo board is empty');
    expect(() => createDemoDocument([frame, frame])).toThrow(/section-0/);
  });
});

describe('writeBoard', () => {
  it('writes a board into an existing store as the product, the same as a new demo document', () => {
    const store = new YjsDocumentStore();
    writeBoard(store, createDemoBoard());
    const reference = createDemoDocument();
    expect([...store.read().objects.values()]).toEqual([...reference.read().objects.values()]);
    expect(createHistory(store, LOCAL_USER_ORIGIN.principalId).undo()).toBe(false);
  });
});
