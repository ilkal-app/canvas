import * as Y from 'yjs';

import type { UndoStep } from './field-guard.js';

/**
 * Remembers what the undos behind the redo steps Yjs drops had deleted, so a later undo can
 * still restore a value over a write of the user's own that one of those undos removed.
 * Single-threaded.
 *
 * Yjs restores a key's earlier value only when every later value of the key was deleted by the
 * step itself, re-created elsewhere, or deleted by a step still on one of the manager's stacks
 * (`isDeletedByUndoStack` in its `redoItem`); anything else it takes for another client's change
 * and refuses to overwrite. A redo step holds what its undo deleted. When the user makes a new
 * change, Yjs drops the redo stack, and with it the knowledge that the user's own later value
 * was removed by the user's own undo: undoing an earlier step of that key was then refused. The
 * history shows Yjs these deletions as one extra step beside the live ones while it applies a
 * step (`single-step.ts`), never as a step to undo or redo. They are only ids: no content is
 * kept alive, and the set grows by the deleted ranges of the dropped steps, merged.
 */
export class ClearedRedoSteps {
  /** What the dropped redo steps' undos deleted, merged; `null` before any was dropped. */
  #deletions: UndoStep['deletions'] | null = null;
  /** The redo stack as it stood when a change Yjs records (and so drops it for) was noted. */
  #redoStackAtCapture: readonly UndoStep[] | null = null;

  /**
   * Notes the redo stack before Yjs records a change by the user (not an undo or redo), which
   * makes it drop the stack. Call it from `captureTransaction` for each such transaction.
   *
   * @param redoStack - The manager's redo stack.
   */
  noteCapture(redoStack: readonly UndoStep[]): void {
    this.#redoStackAtCapture = redoStack;
  }

  /**
   * Keeps the deletions of the redo stack Yjs just dropped for a recorded change. Subscribe it
   * to the manager's `stack-cleared` event. Clearing both stacks (on destroy) keeps nothing.
   *
   * @param event - Which stacks Yjs cleared (Yjs's own flag names).
   */
  readonly onCleared = (
    event: Readonly<Record<'undoStackCleared' | 'redoStackCleared', boolean>>,
  ): void => {
    const dropped = this.#redoStackAtCapture;
    this.#redoStackAtCapture = null;
    if (dropped === null || event.undoStackCleared || !event.redoStackCleared) return;
    const earlier = this.#deletions === null ? [] : [this.#deletions];
    this.#deletions = Y.mergeDeleteSets([...earlier, ...dropped.map((step) => step.deletions)]);
  };

  /**
   * The dropped steps' deletions as a step Yjs can read beside its live stacks.
   *
   * @returns A step that inserts nothing and deletes what the dropped steps' undos deleted, or
   *   `null` when no redo step was dropped.
   */
  asStep(): UndoStep | null {
    if (this.#deletions === null) return null;
    return { insertions: Y.createDeleteSet(), deletions: this.#deletions, meta: new Map() };
  }
}
