// An MCP batch runs several commands, one possibly split into parts, inside one
// `runAsOneStep`, so a nested call must join the open group rather than end it.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { applyCommand, testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { newRectangle } from '../commands/__fixtures__/component-boards.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { UndoGroups, afterParts, runAsOneStep } from './undo-groups.js';
import { createHistory } from './undo-manager.js';

/** One environment for every command of a test, so generated ids never repeat. */
let environment = testEnvironment();

/**
 * Creates one rectangle.
 *
 * @param store - The store.
 * @param id - The rectangle's local id.
 */
function create(store: YjsDocumentStore, id: string): void {
  applyCommand(
    store,
    createObjectsCommand,
    { objects: [newRectangle(id, null, { x: 0, y: 0, width: 10, height: 10 })] },
    ADA,
    environment,
  );
}

/**
 * How many objects the board holds.
 *
 * @param store - The store.
 * @returns The count.
 */
function countOf(store: YjsDocumentStore): number {
  return store.read().objects.size;
}

describe('runAsOneStep', () => {
  it('undoes every transaction of a nested call with the outer group, as one step', () => {
    environment = testEnvironment();
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA_ID);
    runAsOneStep(store, () => {
      create(store, 'a');
      runAsOneStep(store, () => {
        create(store, 'b');
      });
      create(store, 'c');
    });
    expect(countOf(store)).toBe(3);
    expect(history.undo()).toBe(true);
    expect(countOf(store)).toBe(0);
    expect(history.canUndo()).toBe(false);
  });

  it('starts a new group once the outer call has returned', () => {
    environment = testEnvironment();
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA_ID);
    runAsOneStep(store, () => {
      create(store, 'a');
    });
    runAsOneStep(store, () => {
      create(store, 'b');
    });
    expect(history.undo()).toBe(true);
    expect(countOf(store)).toBe(1);
  });
});

describe('part scopes', () => {
  it('rethrows the bookkeeping error over a listener error when a grouped restore ends', () => {
    const store = new YjsDocumentStore();
    const endGroupError = new Error('endGroup');
    const groups = new UndoGroups(store, {
      beginGroup: () => undefined,
      endGroup: () => {
        throw endGroupError;
      },
    });
    const undoStack: { readonly meta: Map<string, unknown> }[] = [];
    const manager = { undoStack, redoStack: [], captureTimeout: 500 } as unknown as Y.UndoManager;
    runAsOneStep(store, () => {
      groups.beforeCapture(manager);
      const step = { meta: new Map<string, unknown>() };
      undoStack.push(step);
      groups.onStepAdded({ stackItem: step });
    });
    let didListen = false;
    const stop = afterParts(store, () => {
      didListen = true;
      throw new Error('listener');
    });
    expect(() => groups.restore(manager, 'undo', () => undoStack.pop() !== undefined)).toThrow(
      endGroupError,
    );
    expect(didListen).toBe(true);
    expect(undoStack).toHaveLength(0);
    stop();
  });
});
