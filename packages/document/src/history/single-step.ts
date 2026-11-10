import * as Y from 'yjs';

import { isGuardedFieldValue, isInsideKeptValue, type UndoStep } from './field-guard.js';
import { KeyReplacements } from './key-replacements.js';

/** Which stack of a `Y.UndoManager` an undo or redo pops. */
type StackName = 'undoStack' | 'redoStack';

/**
 * Applies at most one step of a `Y.UndoManager` per undo or redo, and tells the field
 * guard which step that is (`field-guard.ts`). Single-threaded.
 *
 * Yjs pops a step and, when it changed nothing (another client overwrote all of it, the guard
 * kept every value it would remove, or Yjs refused every restore), pops the next one in the
 * same call, so one undo click could undo several of the user's steps. It loops while the array
 * it was handed is not empty, and pops with that array's `pop()`. So this hands it an array that
 * holds only the newest step, whose `pop()` puts the rest of the stack back as the manager's
 * live stack before returning the step: Yjs then sees the stacks exactly as when it pops the
 * step itself (its conflict rule reads the live stacks while it restores), and its loop ends
 * after the one step. A step that changed nothing is used up: it is off the stack, nothing goes
 * onto the other one, and the steps before it are untouched. Yjs itself is not patched.
 *
 * While Yjs applies the step, its conflict rule may also be shown an extra step that only
 * deletes (`cleared-redo-steps.ts`); it is gone from the stack again when `apply` returns,
 * before Yjs pushes the step's inverse at the end of the enclosing transaction.
 */
export class SingleStep {
  /** The step Yjs is applying, while an undo or redo runs. */
  #current: UndoStep | undefined;
  #replacements: KeyReplacements | undefined;

  /**
   * The step Yjs is applying, for the field guard.
   *
   * @returns The step, or `undefined` outside an undo or redo.
   */
  current(): UndoStep | undefined {
    return this.#current;
  }

  /**
   * The history-walk memo of this apply call, never retained between calls.
   *
   * @returns The memo, or undefined outside an apply call.
   */
  replacements(): KeyReplacements | undefined {
    return this.#replacements;
  }

  /**
   * Applies the field guards with this call's exact step and history-walk memo.
   *
   * @param item - An item Yjs is about to delete.
   * @param objects - The document's top-level objects map.
   * @returns Whether the current field or its contents must stay.
   */
  keepsField(item: Y.Item, objects: Y.Map<unknown>): boolean {
    return (
      isGuardedFieldValue(item, objects, this.#current, this.#replacements) ||
      isInsideKeptValue(item, objects, this.#current, this.#replacements)
    );
  }

  /**
   * Undoes or redoes the newest step of a manager's stack, and only it.
   *
   * @param manager - The manager.
   * @param direction - Which stack to pop.
   * @param extra - A step that only deletes, shown to Yjs beside the live stacks while it
   *   applies the step (never applied itself), or `null`.
   * @param substitute - What Yjs applies in the newest step's place (a copy of it that leaves
   *   some restores out, `restore-guard.ts`), or `null` for the step itself. The newest step
   *   leaves the stack either way.
   * @returns The step when it changed something; `null` when the stack was empty or the step
   *   changed nothing (it is used up all the same).
   * @throws {unknown} What Yjs, or the guard it calls, threw; the step is used up only when Yjs
   *   had popped it.
   */
  apply(
    manager: Y.UndoManager,
    direction: 'undo' | 'redo',
    extra: UndoStep | null = null,
    substitute: UndoStep | null = null,
  ): UndoStep | null {
    const name: StackName = direction === 'undo' ? 'undoStack' : 'redoStack';
    const live = manager[name];
    const step = live.at(-1);
    if (step === undefined) return null;
    const rest = live.slice(0, -1);
    const seen = extra === null ? rest : [extra, ...rest];
    const handed = [substitute ?? step];
    handed.pop = () => {
      manager[name] = seen;
      return Array.prototype.pop.call(handed) as UndoStep | undefined;
    };
    manager[name] = handed;
    this.#current = substitute ?? step;
    this.#replacements = new KeyReplacements(this.#current);
    try {
      return direction === 'undo' ? manager.undo() : manager.redo();
    } finally {
      this.#current = undefined;
      this.#replacements = undefined;
      // Not popped (Yjs threw first): the stack stays as it was.
      if (manager[name] === handed) manager[name] = live;
      else if (manager[name] === seen) manager[name] = rest;
    }
  }

  /**
   * Uses up the newest step of a manager's stack without applying it, as Yjs leaves a step that
   * changed nothing: it is off the stack, nothing goes onto the other one, and the steps before
   * it are untouched. For a step the creation guard will not split (`creation-guard.ts`).
   *
   * @param manager - The manager.
   * @param direction - Which stack to pop.
   */
  discard(manager: Y.UndoManager, direction: 'undo' | 'redo'): void {
    const name: StackName = direction === 'undo' ? 'undoStack' : 'redoStack';
    manager[name] = manager[name].slice(0, -1);
  }

  /**
   * Tells, for the step about to be applied, whether an item was deleted by a step Yjs will see
   * on the live stacks while it applies that step (all but the step itself), or by `extra`: the
   * deletions Yjs's conflict rule lets a restore pass over.
   *
   * @param manager - The manager.
   * @param direction - Which stack's newest step is about to be applied.
   * @param extra - The delete-only step shown beside the stacks, or `null`.
   * @returns The test.
   */
  deletedBySeenSteps(
    manager: Y.UndoManager,
    direction: 'undo' | 'redo',
    extra: UndoStep | null,
  ): (id: Y.ID) => boolean {
    const [own, other] =
      direction === 'undo'
        ? [manager.undoStack, manager.redoStack]
        : [manager.redoStack, manager.undoStack];
    const seen = [...own.slice(0, -1), ...other, ...(extra === null ? [] : [extra])];
    return (id) => seen.some((step) => Y.isDeleted(step.deletions, id));
  }
}
