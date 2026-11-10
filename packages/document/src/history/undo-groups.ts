import type * as Y from 'yjs';

import type { DocumentStore } from '../store/document-store.js';
import { RunStoppedError, type StoreRun } from '../store/store-run.js';

import type { UndoStep } from './field-guard.js';

// One command written in several transactions, so each stays under the collab client's chunk
// size (a paste, import or delete of thousands of objects), is still one undo step for
// the person: the command layer runs its transactions inside `runAsOneStep`, every history
// recording them keeps each as a step of its own (never merged, so an undo or redo of it is a
// transaction of the same size, which the client sends whole), tagged with the group, and an
// undo or redo takes every step of the group, the last written first. Each step keeps its own
// causal past (`causal-past.ts`) and goes through the guards as any step does; the
// creation guard also keeps, in a later part, what an object an earlier part kept lies in.

/** The `meta` key of a step's group. */
const GROUP_KEY = 'canvas:undo-group';

/** The group each store's transactions belong to now, while a command writes its parts. */
const writingGroups = new WeakMap<DocumentStore, number>();

/** The next group's id; unique in the process. */
let nextGroup = 1;

/** The innermost store each forwarding store writes through (`forwardUndoSteps`). */
const forwardedTo = new WeakMap<DocumentStore, DocumentStore>();

/**
 * Declares that every transaction `wrapper` makes is one of `store`'s: a store that
 * delegates its writes, as the app's page stores do, so that a command run through it groups its
 * parts on the store a history records (`runAsOneStep`). Call it once, from the wrapper's
 * constructor: a wrapper of a wrapper resolves to the innermost store, which `store` already
 * names when it forwards itself.
 *
 * @param wrapper - The store commands write through.
 * @param store - The store its transactions are made on.
 */
export function forwardUndoSteps(wrapper: DocumentStore, store: DocumentStore): void {
  forwardedTo.set(wrapper, rootOf(store));
}

/**
 * The store a store's transactions are made on (`forwardUndoSteps`).
 *
 * @param store - The store written to.
 * @returns The innermost store; `store` itself when it forwards to none.
 */
export function rootOf(store: DocumentStore): DocumentStore {
  return forwardedTo.get(store) ?? store;
}

/** A step of `Y.UndoManager`, as far as groups read it. */
interface GroupedStep {
  /** The step's metadata. */
  readonly meta: Map<string, unknown>;
}

/** How many part scopes (a group being written or restored) are open on each root store. */
const openParts = new WeakMap<DocumentStore, number>();

/** What runs when the outermost part scope on a root store ends (`afterParts`). */
const partsEnded = new WeakMap<DocumentStore, Set<() => void>>();

/**
 * Whether a command's parts, or a grouped undo or redo, are being applied to the store now:
 * a listener may hold what it would work out from each part's change set until
 * {@link afterParts} says they ended, and do it once.
 *
 * @param store - The store, or a store that forwards to it (`forwardUndoSteps`).
 * @returns `true` inside `runAsOneStep` or a grouped restore on its root.
 */
export function isApplyingInParts(store: DocumentStore): boolean {
  return (openParts.get(rootOf(store)) ?? 0) > 0;
}

/**
 * Calls `listener` each time the outermost part scope on the store's root ends: a
 * `runAsOneStep` group written (a nested one does not end it) or a grouped undo or redo
 * restored, also when it threw.
 *
 * @param store - The store, or a store that forwards to it.
 * @param listener - What to call.
 * @returns Stops calling it.
 */
export function afterParts(store: DocumentStore, listener: () => void): () => void {
  const root = rootOf(store);
  const listeners = partsEnded.get(root) ?? new Set<() => void>();
  partsEnded.set(root, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Runs `apply` as one part scope on the store's root, telling {@link afterParts}'s listeners
 * when the outermost scope ends; the first listener error is rethrown after all ran, unless
 * `apply` threw. `settle` ends the scope's own bookkeeping (the writing group, the group being
 * restored) before the listeners run, so a command a listener runs is a step of its own with
 * its own part scope.
 *
 * @param store - The store.
 * @param apply - What applies the parts.
 * @param settle - Ends the caller's bookkeeping, whether `apply` returned or threw; its error
 *   wins over a listener's.
 * @returns What `apply` returns.
 * @throws {unknown} What `apply` or `settle` threw, else the first listener error.
 */
export function inPartsScope<Result>(
  store: DocumentStore,
  apply: () => Result,
  settle: () => void,
): Result {
  const root = rootOf(store);
  openParts.set(root, (openParts.get(root) ?? 0) + 1);
  let isDone = false;
  try {
    const result = apply();
    isDone = true;
    return result;
  } finally {
    const depth = (openParts.get(root) ?? 1) - 1;
    openParts.set(root, depth);
    try {
      settle();
    } catch (error) {
      // The listeners still run; their errors give way to the bookkeeping's own.
      if (depth === 0) endParts(root, false);
      throw error;
    }
    if (depth === 0) endParts(root, isDone);
  }
}

/**
 * Tells the listeners of a root store that its outermost part scope ended.
 *
 * @param root - The root store.
 * @param isDone - Whether the scope returned; when it threw, a listener's error is dropped
 *   so the scope's own error propagates.
 * @throws {unknown} The first error a listener threw, when the scope returned.
 */
function endParts(root: DocumentStore, isDone: boolean): void {
  const errors: unknown[] = [];
  for (const listener of [...(partsEnded.get(root) ?? [])]) {
    try {
      listener();
    } catch (error) {
      errors.push(error);
    }
  }
  if (isDone && errors.length > 0) throw errors[0];
}

/**
 * Runs `write` so that every transaction it makes on `store` is one part of a single undo step.
 * Any transaction a history records during `write` joins the group, a store listener's write
 * with the user's origin included, so `write` should make only the command's own transactions.
 * A nested call joins the group already open on the store (an MCP `batch` runs several commands,
 * one of them split into parts, as one step:). A store that forwards its writes
 * (`forwardUndoSteps`) groups on the store it writes through, so a history of that store sees
 * the group.
 *
 * @param store - The store written to.
 * @param write - Makes the transactions.
 * @returns What `write` returns.
 */
export function runAsOneStep<Result>(store: DocumentStore, write: () => Result): Result {
  const root = rootOf(store);
  if (writingGroups.has(root)) return write();
  writingGroups.set(root, nextGroup);
  nextGroup += 1;
  return inPartsScope(root, write, () => writingGroups.delete(root));
}

/**
 * Opens one undo step on the store's root that stays open across browser tasks:
 * every transaction a history records until the returned function is called is a part of it, as
 * inside `runAsOneStep`, but the caller decides when it ends. Joins a group already open on the
 * root, and then ends nothing. A stepped run holds the store meanwhile (`StoreRun`), so no other
 * writer's transaction can join it.
 *
 * @param store - The store written to, or one that forwards to it.
 * @returns Ends the step; calling it again does nothing.
 */
export function openStep(store: DocumentStore): () => void {
  const root = rootOf(store);
  if (writingGroups.has(root)) return () => undefined;
  writingGroups.set(root, nextGroup);
  nextGroup += 1;
  let isOpen = true;
  return () => {
    if (!isOpen) return;
    isOpen = false;
    writingGroups.delete(root);
  };
}

/**
 * The group a step belongs to.
 *
 * @param step - The step, if any.
 * @returns Its group, or `undefined` for a step of one transaction.
 */
function groupOf(step: GroupedStep | undefined): number | undefined {
  return step?.meta.get(GROUP_KEY) as number | undefined;
}

/** What learns that an undo or redo of a grouped step starts and ends (the creation guard). */
export interface GroupRestoreListener {
  /**
   * A grouped step's first part is about to be undone or redone.
   *
   * @param steps - All parts, newest first, before any part changes the board.
   */
  beginGroup(steps: readonly UndoStep[]): void;
  /** Its last part has been undone or redone, or the restore threw. */
  endGroup(): void;
}

/** One history's bookkeeping of grouped steps. */
export class UndoGroups {
  readonly #store: DocumentStore;
  readonly #listener: GroupRestoreListener | undefined;
  #configuredWindow: number | undefined;
  /** The group of the transaction being recorded, until its step is added. */
  #capturing: number | undefined;
  /** The group of the last recorded transaction of the user's. */
  #lastCaptured: number | undefined;
  /** The group being undone or redone, so the steps it pushes on the other stack join it. */
  #restoring: number | undefined;

  /**
   * Keeps the groups of one history.
   *
   * @param store - The store the history records.
   * @param listener - Learns when a grouped step's undo or redo starts and ends.
   */
  constructor(store: DocumentStore, listener?: GroupRestoreListener) {
    this.#store = store;
    this.#listener = listener;
  }

  /**
   * Prepares the recording of one of the user's transactions; call it from `captureTransaction`,
   * which `Y.UndoManager` calls before it decides whether to merge. A group's parts merge neither
   * with each other nor with the steps around them; otherwise the configured window applies.
   *
   * @param manager - The history's undo manager.
   */
  beforeCapture(manager: Y.UndoManager): void {
    const group = writingGroups.get(this.#store);
    this.#configuredWindow ??= manager.captureTimeout;
    const isApart = group !== undefined || this.#lastCaptured !== undefined;
    manager.captureTimeout = isApart ? 0 : this.#configuredWindow;
    this.#capturing = group;
    this.#lastCaptured = group;
  }

  /**
   * Tags a step `Y.UndoManager` just added with its group: the group being written, or the
   * group being undone or redone (for the step it pushes on the other stack). Subscribe it to
   * the manager's `stack-item-added` event.
   *
   * @param event - The event.
   * @param event.stackItem - The new step.
   */
  readonly onStepAdded = ({ stackItem }: { readonly stackItem: GroupedStep }): void => {
    const group = this.#restoring ?? this.#capturing;
    if (group !== undefined) stackItem.meta.set(GROUP_KEY, group);
    this.#capturing = undefined;
  };

  /**
   * Undoes or redoes the newest step, and every step of its group with it, newest first, one
   * transaction each.
   *
   * @param manager - The history's undo manager.
   * @param direction - Which stack.
   * @param restoreOne - Undoes or redoes the newest step of that stack, in one transaction.
   * @returns `true` when something changed.
   * @throws {unknown} What the group listener's `beginGroup`, a part, or `endGroup` threw.
   */
  restore(manager: Y.UndoManager, direction: 'undo' | 'redo', restoreOne: () => boolean): boolean {
    const newest = (): GroupedStep | undefined =>
      (direction === 'undo' ? manager.undoStack : manager.redoStack).at(-1);
    const group = groupOf(newest());
    if (group === undefined) return restoreOne();
    const steps = this.#stepsOf(manager, direction, group);
    this.#restoring = group;
    try {
      this.#listener?.beginGroup(steps);
    } catch (error) {
      // Nothing restored; the guards that began are ended by the listener.
      this.#restoring = undefined;
      throw error;
    }
    let isChanged = false;
    // One part scope for the whole group, so page listeners hear its parts once.
    inPartsScope(
      this.#store,
      () => {
        while (groupOf(newest()) === group) isChanged = restoreOne() || isChanged;
      },
      () => {
        this.#restoring = undefined;
        this.#listener?.endGroup();
      },
    );
    return isChanged;
  }

  /**
   * Undoes or redoes the newest step a part per task, as `restore` but each part
   * in its own task, transaction and part scope, inside `run`'s authority, listeners told after;
   * guards and `#restoring` held across yields, the group re-checked, `run` closed at the end.
   *
   * @param manager - The history's undo manager.
   * @param direction - Which stack.
   * @param restoreOne - Undoes or redoes the newest step of that stack, in one transaction,
   *   without telling the history's subscribers.
   * @param notify - Tells the history's subscribers, after a part.
   * @param run - The open run holding the store.
   * @param yieldToBrowser - Lets the browser run between two parts.
   * @returns How many parts the step had and how many were restored.
   * @throws {RunStoppedError} When a part, a guard or a yield threw: the parts restored stay.
   */
  async restoreInSteps(
    manager: Y.UndoManager,
    direction: 'undo' | 'redo',
    restoreOne: () => boolean,
    notify: () => void,
    run: StoreRun,
    yieldToBrowser: () => Promise<void>,
  ): Promise<{ readonly parts: number; readonly committedParts: number }> {
    const stack = () => (direction === 'undo' ? manager.undoStack : manager.redoStack);
    const count: { committed: number; planned?: number } = { committed: 0 };
    const restorePart = (total: number): void => {
      const before = stack().length;
      count.planned = total;
      try {
        inPartsScope(
          this.#store,
          () => run.enter(restoreOne),
          () => undefined,
        );
      } finally {
        if (stack().length < before) run.progress(++count.committed, total);
        notify();
      }
    };
    try {
      const group = groupOf(stack().at(-1));
      if (group === undefined) {
        restorePart(1);
        return { parts: 1, committedParts: count.committed };
      }
      const steps = this.#stepsOf(manager, direction, group);
      this.#restoring = group;
      let isBegun = false;
      try {
        this.#listener?.beginGroup(steps);
        isBegun = true;
        restorePart(steps.length);
        while (groupOf(stack().at(-1)) === group) {
          await yieldToBrowser();
          run.checkStop();
          restorePart(steps.length);
        }
      } finally {
        this.#restoring = undefined;
        if (isBegun) this.#listener?.endGroup();
      }
      return { parts: steps.length, committedParts: count.committed };
    } catch (error) {
      throw new RunStoppedError(count.committed, undefined, error, count.planned);
    } finally {
      run.close();
    }
  }

  /**
   * The steps of a group on a stack, newest first.
   *
   * @param manager - The history's undo manager.
   * @param direction - Which stack.
   * @param group - The group.
   * @returns Its steps, from the newest.
   */
  #stepsOf(manager: Y.UndoManager, direction: 'undo' | 'redo', group: number): UndoStep[] {
    const stack = direction === 'undo' ? manager.undoStack : manager.redoStack;
    const steps: UndoStep[] = [];
    for (const step of [...stack].reverse()) {
      if (groupOf(step) !== group) break;
      steps.push(step);
    }
    return steps;
  }
}
