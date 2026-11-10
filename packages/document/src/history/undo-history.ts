import type { PrincipalId } from '@canvas/schema';

import type { StoreBusyError } from '../store/store-run.js';

import type { UndoOmission } from './door-guard.js';
import type { OperatedWriters } from './operated-writes.js';
import type { UndoProtection } from './protection.js';
import type { UndoHistoryState } from './undo-history-state.js';

export type { UndoOmission } from './door-guard.js';

/** Options of `createHistory`. */
export interface UndoHistoryOptions {
  /**
   * Changes captured within this many ms of the previous captured change merge into its step,
   * until {@link UndoHistory.stopCapturing}. The default, 0, makes every transaction its own
   * step; the command layer runs one transaction per command, so one command is one step.
   */
  readonly captureTimeout?: number;
  /**
   * Makes a keyed history, matching `HISTORY_KEY_PATTERN`: it records only the changes
   * of agents the user operates whose origin carries this `historyKey`, and undoes only those.
   * Without one, the history records only changes whose origin has no key, as before.
   */
  readonly historyKey?: string;
  /**
   * Which Yjs client ids write for agents the user operates: with it, the history also
   * records a remote transaction written under exactly one client id `records` accepts, so the
   * user undoes an agent that writes from another process (the hosted MCP server) as their own
   * change; it undoes such a step only while `owns` accepts its id, and drops it otherwise. The
   * caller decides whom to trust; the app owns only client ids the relay vouches for.
   * Without it, only the store's own transactions are recorded, as before.
   */
  readonly operatedWriters?: OperatedWriters;
}

/** What a stepped undo or redo did (`UndoHistory.startRestore`). */
export interface RestoreReport {
  /** How many parts the step had: one per transaction it was written in. */
  readonly parts: number;
  /** How many were restored: all of them. */
  readonly committedParts: number;
  /**
   * Whether it changed the document, as `undo()` and `redo()` say: false when every change it
   * held was overwritten since, or kept for another person's edit, so the step was used up.
   */
  readonly isChanged: boolean;
  /** Why some of it was not restored, as `lastOmission` reports it. */
  readonly omission: UndoOmission | undefined;
  /** What it left in place for others' edits, as `lastProtection` reports it. */
  readonly protection: UndoProtection | undefined;
  /** How many objects it did not re-create, as `lastOmittedObjects` reports it. */
  readonly omittedObjects: number;
}

/**
 * One user's undo history over a document: it records the user's own
 * changes and those of agents the user operates, one step per command, and undoes and
 * redoes only those. Changes by other principals, the product's own changes and remote updates
 * are never recorded, so undo reverts only what this user did; where another principal has
 * since changed the same field, that change wins and is kept, and no undo leaves a field
 * without a value (`field-guard.ts`); no undo or redo removes an object another person has
 * written to, written to a child of, or made another object refer to, since the step, nor
 * writes over a copy of another person's value (`creation-guard.ts`, `restore-guard.ts`); and
 * no undo or redo writes a value the relay's door would refuse (`door-guard.ts`).
 * Steps are Yjs deltas, so they stay valid across disconnection and reconnection of the same
 * store. Single-threaded; not callable from a store listener (it writes through `transact`).
 */
export interface UndoHistory {
  /** The user whose history this is. */
  readonly principalId: PrincipalId;
  /**
   * Reverts the newest step in one transaction whose origin is `{ kind: 'undo', principalId }`
   * (a step of several parts: in one transaction per part, the last part first), and
   * makes it redoable. It reverts at most that one step: a step that can change nothing any
   * more (others have since overwritten all of it, reverting it would remove only values the
   * field guard keeps, or only objects and values others have touched since, which the
   * creation guard keeps; or only values inside objects deleted since) is used up, and the steps
   * before it are left for the next undo. So is a step Yjs would fail on part-way: it
   * is used up unapplied, never half-applied. What the relay's door would refuse is left out and
   * the rest applies ({@link UndoHistory.lastOmission}).
   *
   * @returns `true` when something changed; `false` when there was no step, or the newest one
   *   changed nothing and was used up (then {@link UndoHistory.canUndo} may still be `true`).
   */
  undo(): boolean;
  /**
   * Reapplies the newest undone step, in one transaction with the undo origin, and at most that
   * one, as {@link UndoHistory.undo}. A new change by the user drops every redoable step.
   *
   * @returns `true` when something changed; `false` when there was no step, or the newest one
   *   changed nothing and was used up.
   */
  redo(): boolean;
  /**
   * Why the last {@link UndoHistory.undo} or {@link UndoHistory.redo} left part of its step out
   * for a reason the person is told apart from "this has changed since":
   * `'out-of-range'` when it would have written back a value the relay's door refuses (a size
   * past 2^32, a non-finite coordinate a peer left), which it left out, together with an object
   * whose re-creation would hold such a value ({@link UndoHistory.lastOmittedObjects}); the
   * objects deleted with it come back, re-rooted or detached by the reference repair, and the
   * rest applied. The step is used up all the same.
   *
   * @returns The reason, or `undefined` when nothing was left out for it (or no undo or redo has
   *   run yet).
   */
  lastOmission(): UndoOmission | undefined;
  /**
   * Why the last {@link UndoHistory.undo} or {@link UndoHistory.redo} changed nothing, when it
   * was because another person edited since what its step would change (X2; the
   * PROTECT rule of and): those objects and the Yjs client ids that edited them,
   * which the app names from presence and outlines in their colour.
   *
   * @returns The protection, or `undefined` when the last undo or redo changed something, was
   *   used up for another reason, or none has run yet.
   */
  lastProtection(): UndoProtection | undefined;
  /**
   * How many whole objects the last {@link UndoHistory.undo} or {@link UndoHistory.redo} did not
   * bring back because they hold a value the relay's door refuses (fix round 1): the
   * undo of their delete re-created the rest of the step, their children re-rooted and the
   * connectors and comments that referred to them detached.
   *
   * @returns The count, 0 when every object the step re-creates was re-created.
   */
  lastOmittedObjects(): number;
  /**
   * Tells whether there is a step to undo.
   *
   * @returns `true` when {@link UndoHistory.undo} has a step to revert.
   */
  canUndo(): boolean;
  /**
   * Tells whether there is a step to redo.
   *
   * @returns `true` when {@link UndoHistory.redo} has a step to reapply.
   */
  canRedo(): boolean;
  /**
   * Ends the current step, so the next captured change starts a new one even inside the
   * capture window. With the default window of 0 every command is already its own step.
   */
  stopCapturing(): void;
  /**
   * Calls `listener` with the new state whenever `canUndo` or `canRedo` changes. It is called
   * synchronously, possibly inside a store transaction, so it must not write.
   *
   * @param listener - Receives the state.
   * @returns A function that unsubscribes.
   */
  subscribe(listener: (state: UndoHistoryState) => void): () => void;
  /**
   * Undoes or redoes the newest step a task per part: a step written in parts
   * (a large paste or delete) is restored one part per browser task, the store held meanwhile
   * (`StoreRun`: every other mutation throws `StoreBusyError`) and the guards' group state kept
   * across the yields, so it is still one step for the user. The first part is restored in the
   * calling task; page listeners hear each part in its own task. A step of one part is restored
   * at once.
   *
   * @param direction - Undo or redo.
   * @param options - How to yield between parts.
   * @param options.yieldToBrowser - Lets the browser run between two parts.
   * @returns `undefined` when there is nothing to undo or redo; otherwise the report, which
   *   rejects with `RunStoppedError` when the restore stopped before its last part.
   * @throws {StoreBusyError} When a run holds the store.
   */
  startRestore(
    direction: 'undo' | 'redo',
    options: { readonly yieldToBrowser: () => Promise<void> },
  ): Promise<RestoreReport> | undefined;
  /** Stops recording and releases the steps; the history cannot be used afterwards. */
  destroy(): void;
}
