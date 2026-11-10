import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { reachesCollectedCopy } from './collected-copies.js';
import type { UndoStep } from './field-guard.js';

// On a bare `Y.UndoManager`, without the history: the sequence that makes Yjs 13.6.33's
// `redoItem` throw, and the walk that tells so beforehand. The first test pins the Yjs defect;
// when a Yjs upgrade makes it pass without throwing, re-read `collected-copies.ts`.

/**
 * A map holding one shape map, with a history over it, after the sequence in the module comment
 * of `collected-copies.ts`: step 1 sets x, step 2 deletes the shape and is undone (Yjs's copy),
 * step 3 sets x in the copy and is undone, step 4 clears that redo step, another client's delete
 * collects the copy, and step 4 is undone. Step 1 is left on the stack.
 *
 * @returns The document, the map and the manager.
 */
function arrange() {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>('root');
  doc.transact(() => {
    const shape = new Y.Map<number>();
    root.set('shape', shape);
    shape.set('x', 0);
  }, 'setup');
  const manager = new Y.UndoManager(root, { captureTimeout: 0 });
  const shape = () => root.get('shape') as Y.Map<number>;
  shape().set('x', 1);
  root.delete('shape');
  manager.undo();
  shape().set('x', 2);
  manager.undo();
  root.set('other', 1);
  doc.transact(() => {
    root.delete('shape');
  }, 'remote');
  return { doc, root, manager };
}

/**
 * Asks the walk about the newest undo step, with the other steps as Yjs sees them meanwhile.
 *
 * @param doc - The document.
 * @param root - The manager's scope.
 * @param manager - The manager.
 * @returns What `reachesCollectedCopy` says.
 * @throws {Error} When the undo stack is empty.
 */
function predicts(doc: Y.Doc, root: Y.Map<unknown>, manager: Y.UndoManager): boolean {
  const step: UndoStep | undefined = manager.undoStack.at(-1);
  if (step === undefined) throw new Error('No step to undo');
  const seen = [...manager.undoStack.slice(0, -1), ...manager.redoStack];
  const isOwnDeletion = (id: Y.ID) => seen.some((other) => Y.isDeleted(other.deletions, id));
  return doc.transact((transaction) =>
    reachesCollectedCopy(transaction, step, root, isOwnDeletion),
  );
}

describe('an undo whose value leads to a collected copy, on a bare Y.UndoManager', () => {
  it('throws inside Yjs 13.6.33, after popping the step', () => {
    const { manager } = arrange();
    manager.undo(); // step 4

    expect(() => manager.undo()).toThrow(TypeError);
    expect(manager.undoStack).toHaveLength(0);
  });

  it('is told beforehand, and the steps Yjs applies are not', () => {
    const { doc, root, manager } = arrange();

    expect(predicts(doc, root, manager)).toBe(false); // step 4
    manager.undo();
    expect(predicts(doc, root, manager)).toBe(true); // step 1
  });

  it('writes nothing to the document while it reads', () => {
    const { doc, root, manager } = arrange();
    manager.undo();
    const before = Y.encodeStateAsUpdate(doc);

    predicts(doc, root, manager);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
