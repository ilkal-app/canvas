import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { causalPastOf, CausalPastRecorder } from './causal-past.js';

// The field guard judges a step against what its user had in view (fix round 2): the
// state vector before the step's first transaction, recorded on every step Yjs creates.

const LOCAL = 'local';

/**
 * A document with an undo manager over a map that records every step's causal past, and a
 * second document to write concurrently from.
 *
 * @param captureTimeout - The manager's capture window, ms.
 * @returns The documents, the map and the manager.
 */
function recordedDocument(captureTimeout: number) {
  const doc = new Y.Doc();
  doc.clientID = 1;
  const other = new Y.Doc();
  other.clientID = 2;
  const map = doc.getMap('objects');
  const recorder = new CausalPastRecorder();
  const manager = new Y.UndoManager(map, {
    captureTimeout,
    trackedOrigins: new Set([LOCAL]),
    captureTransaction: (transaction) => {
      recorder.noteCaptured(transaction);
      return true;
    },
  });
  manager.on('stack-item-added', recorder.onStepAdded);
  return { doc, other, map, manager };
}

/**
 * Writes a key in the other document and delivers everything it has to the first one.
 *
 * @param doc - The receiving document.
 * @param other - The writing document.
 * @param key - The key.
 */
function writeRemotely(doc: Y.Doc, other: Y.Doc, key: string): void {
  other.getMap('objects').set(key, 'remote');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
}

describe('the causal past of a step', () => {
  it('is the state before the first of the transactions merged into the step', () => {
    const { doc, other, map, manager } = recordedDocument(60_000);
    writeRemotely(doc, other, 'z');
    const before = Y.getState(doc.store, 2);
    expect(before).toBeGreaterThan(0);
    doc.transact(() => map.set('a', 1), LOCAL);
    writeRemotely(doc, other, 'b');
    doc.transact(() => map.set('c', 1), LOCAL);
    expect(manager.undoStack).toHaveLength(1);
    const [step] = manager.undoStack;
    expect(step && causalPastOf(step)?.state.get(2)).toBe(before);
    expect(step && causalPastOf(step)?.clientId).toBe(1);
  });

  it('is recorded for the steps an undo and a redo push, as of that undo or redo', () => {
    const { doc, other, map, manager } = recordedDocument(0);
    doc.transact(() => map.set('a', 1), LOCAL);
    writeRemotely(doc, other, 'b');
    const seenAtUndo = Y.getState(doc.store, 2);
    manager.undo();
    const [undone] = manager.redoStack;
    expect(undone && causalPastOf(undone)?.state.get(2)).toBe(seenAtUndo);
    writeRemotely(doc, other, 'c');
    const seenAtRedo = Y.getState(doc.store, 2);
    manager.redo();
    const [redone] = manager.undoStack;
    expect(redone && causalPastOf(redone)?.state.get(2)).toBe(seenAtRedo);
  });
});
