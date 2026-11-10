import * as Y from 'yjs';

import type { ObjectId, PrincipalId } from '@canvas/schema';

import { parseTransactionOrigin, type TransactionOrigin } from '../origin/transaction-origin.js';
import { LastKnownBoard } from '../repair/last-known-board.js';
import { applyReferenceRepair, planReferenceRepair } from '../repair/reference-repair.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf, type StoreInternals } from '../store/internal.js';

import { CausalPastRecorder } from './causal-past.js';
import { ClearedRedoSteps } from './cleared-redo-steps.js';
import { CreationGuard } from './creation-guard.js';
import { DefinitionGuard } from './definition-guard.js';
import { DoorGuard, type UndoOmission } from './door-guard.js';
import { restoreEmptiedFields } from './field-guard.js';
import { guardGroupListener } from './guard-group.js';
import { handedStep, type StepGuards } from './handed-step.js';
import { registerDepths } from './history-depths.js';
import { readHistoryCapture, readUserPrincipal, type HistoryCapture } from './history-options.js';
import { HistoryStateListeners } from './history-state-listeners.js';
import { OperatedCapture } from './operated-writes.js';
import { isOwnedBy } from './origin-ownership.js';
import { mergeProtections, type UndoProtection } from './protection.js';
import { SingleStep } from './single-step.js';
import { startSteppedRestore } from './stepped-restore.js';
import { touchedObjectIds } from './touched-objects.js';
import { UndoGroups } from './undo-groups.js';
import type { UndoHistoryState } from './undo-history-state.js';
import type { RestoreReport, UndoHistory, UndoHistoryOptions } from './undo-history.js';

export type {
  RestoreReport,
  UndoHistory,
  UndoHistoryOptions,
  UndoOmission,
} from './undo-history.js';
export type { UndoHistoryState } from './undo-history-state.js';

/** {@link UndoHistory} over a `Y.UndoManager` scoped to the store's objects map. */
class YjsUndoHistory implements UndoHistory {
  readonly principalId: PrincipalId;
  readonly #store: DocumentStore;
  readonly #internals: StoreInternals;
  readonly #doc: Y.Doc;
  readonly #objects: Y.Map<unknown>;
  readonly #pages: Y.Map<unknown>;
  readonly #manager: Y.UndoManager;
  readonly #undoOrigin: TransactionOrigin;
  readonly #historyKey: string | undefined;
  readonly #operated: OperatedCapture | undefined;
  readonly #states = new HistoryStateListeners();
  /** Applies one step per undo or redo, and tells the field guard which. */
  readonly #singleStep = new SingleStep();
  /** Records each step's causal past and write lane as Yjs creates it, for the guards. */
  readonly #causalPasts: CausalPastRecorder;
  /** What the undos behind dropped redo steps deleted, for Yjs's conflict rule. */
  readonly #clearedRedoSteps = new ClearedRedoSteps();
  /** The objects the step being applied must not remove. */
  readonly #creationGuard: CreationGuard;
  readonly #definitionGuard: DefinitionGuard;
  /** The restores the relay's door would refuse, which the step leaves out. */
  readonly #doorGuard: DoorGuard;
  readonly #groups: UndoGroups;
  /** What decides what Yjs applies in a step's place (`handed-step.ts`). */
  readonly #stepGuards: StepGuards;
  /** Why the last undo or redo was used up with nothing changed, when others edited since. */
  #protection: UndoProtection | undefined;
  #isDestroyed = false;

  /**
   * Starts recording.
   *
   * @param store - A Yjs store.
   * @param principalId - The user, already validated.
   * @param options - The capture window, ms, and the history key, already validated.
   */
  constructor(store: DocumentStore, principalId: PrincipalId, options: HistoryCapture) {
    this.principalId = principalId;
    this.#historyKey = options.historyKey;
    this.#operated = OperatedCapture.of(options.operatedWriters);
    this.#store = store;
    this.#undoOrigin = parseTransactionOrigin({ kind: 'undo', principalId });
    this.#internals = internalsOf(store);
    const { doc, objects, pages, tokens, styles } = this.#internals;
    this.#doc = doc;
    this.#objects = objects;
    this.#pages = pages;
    this.#causalPasts = new CausalPastRecorder(doc, options.historyKey, this.#operated?.writes);
    const creation = new CreationGuard(objects, store);
    const definition = new DefinitionGuard(objects, store);
    this.#creationGuard = creation;
    this.#definitionGuard = definition;
    const doorGuard = new DoorGuard(objects);
    this.#doorGuard = doorGuard;
    this.#stepGuards = { store, internals: this.#internals, creation, door: doorGuard, definition };
    this.#groups = new UndoGroups(
      store,
      guardGroupListener(this.#definitionGuard, this.#creationGuard, doorGuard),
    );
    // Pages, tokens, styles too: a command is one step with them.
    this.#manager = new Y.UndoManager([objects, pages, tokens, styles.text, styles.effect], {
      captureTimeout: options.captureTimeout,
      captureTransaction: (transaction) => this.#isCaptured(transaction),
      // Undo replaces a field's value but never removes it, nor empties it (`field-guard.ts`),
      // never removes an object someone else has touched since (`creation-guard.ts`), and keeps
      // a key whose restore the door would refuse as it is (`door-guard.ts`).
      deleteFilter: (item) =>
        !this.#singleStep.keepsField(item, objects) &&
        !this.#creationGuard.keeps(item) &&
        !this.#definitionGuard.keeps(item) &&
        !doorGuard.keeps(item),
      // Track fresh plain-object origins by constructor, then decide ownership by value.
      // Yjs's own null-origin transactions are never tracked.
      trackedOrigins: new Set([Object]),
    });
    registerDepths(this, () => ({
      undo: this.#manager.undoStack.length,
      redo: this.#manager.redoStack.length,
    }));
    this.#manager.on('stack-item-added', this.#causalPasts.onStepAdded);
    this.#manager.on('stack-item-added', this.#onStepAdded);
    this.#manager.on('stack-item-added', this.#groups.onStepAdded);
    this.#operated?.listen(this.#manager);
    this.#manager.on('stack-cleared', this.#clearedRedoSteps.onCleared);
  }

  /** @inheritdoc */
  undo(): boolean {
    this.#internals.runs.check();
    this.#doorGuard.clearOmission();
    this.#protection = undefined;
    const prepared = this.#operated?.prepareUndo(this.#manager);
    if (prepared?.isDropped === true) this.#notifyIfChanged();
    if (prepared?.isPending === true) return false;
    return this.#groups.restore(this.#manager, 'undo', () => this.#restore('undo'));
  }

  /** @inheritdoc */
  redo(): boolean {
    this.#internals.runs.check();
    this.#doorGuard.clearOmission();
    this.#protection = undefined;
    return this.#groups.restore(this.#manager, 'redo', () => this.#restore('redo'));
  }
  /** @inheritdoc */
  startRestore(
    direction: 'undo' | 'redo',
    options: { readonly yieldToBrowser: () => Promise<void> },
  ): Promise<RestoreReport> | undefined {
    this.#checkAlive();
    if (this.#operated?.prepareUndo(this.#manager, direction).isPending) return undefined;
    return startSteppedRestore({
      internals: this.#internals,
      manager: this.#manager,
      groups: this.#groups,
      direction,
      yieldToBrowser: options.yieldToBrowser,
      clearLast: () => {
        this.#doorGuard.clearOmission();
        this.#protection = undefined;
      },
      restoreOne: () => this.#restore(direction, false),
      notify: this.#notifyIfChanged,
      history: this,
    });
  }

  /** @inheritdoc */
  lastOmission(): UndoOmission | undefined {
    return this.#doorGuard.omission;
  }

  /** @inheritdoc */
  lastProtection(): UndoProtection | undefined {
    return this.#protection;
  }

  /** @inheritdoc */
  lastOmittedObjects(): number {
    return this.#doorGuard.omittedObjects;
  }

  /**
   * @inheritdoc
   * @throws {Error} After `destroy()`.
   */
  canUndo(): boolean {
    this.#checkAlive();
    return this.#operated?.canUndo(this.#manager) ?? this.#manager.canUndo();
  }

  /**
   * @inheritdoc
   * @throws {Error} After `destroy()`.
   */
  canRedo(): boolean {
    this.#checkAlive();
    return this.#manager.canRedo();
  }

  /**
   * @inheritdoc
   * @throws {Error} After `destroy()`.
   */
  stopCapturing(): void {
    this.#checkAlive();
    this.#manager.stopCapturing();
  }

  /**
   * @inheritdoc
   * @throws {Error} After `destroy()`.
   */
  subscribe(listener: (state: UndoHistoryState) => void): () => void {
    this.#checkAlive();
    return this.#states.add(listener);
  }

  /** @inheritdoc */
  destroy(): void {
    if (this.#isDestroyed) return;
    this.#isDestroyed = true;
    this.#states.clear();
    // Clearing lets Yjs collect the deleted content the steps were keeping alive.
    this.#manager.clear();
    this.#manager.destroy();
  }

  /**
   * Whether a transaction's changes are recorded: local transactions owned by this user and key,
   * this history's own undo and redo transactions (which Yjs puts on the opposite stack), and
   * remote ones of an agent the user operates (`operated-writes.ts`).
   *
   * @param transaction - The finished Yjs transaction.
   * @returns `true` to record it.
   */
  #isCaptured(transaction: Y.Transaction): boolean {
    const isRestoring = this.#manager.undoing || this.#manager.redoing;
    const isCaptured =
      (transaction.local &&
        (isRestoring || isOwnedBy(transaction.origin, this.principalId, this.#historyKey))) ||
      (!isRestoring && this.#operated?.captures(transaction, this.#manager) === true);
    if (isCaptured) this.#causalPasts.noteCaptured(transaction);
    // Yjs drops the redo stack for a recorded change of the user's own; a command written in
    // parts is one step of several (`undo-groups.ts`).
    if (isCaptured && !isRestoring) {
      this.#clearedRedoSteps.noteCapture(this.#manager.redoStack);
      this.#groups.beforeCapture(this.#manager);
    }
    return isCaptured;
  }

  /**
   * Restores one attributed step and repairs its references in the same transaction, so redo
   * also restores attachments. The system repair pass follows for any remaining references.
   *
   * @param direction - Which stack to pop.
   * @param isNotifying - Whether to tell subscribers; a stepped restore does it itself.
   * @returns `true` when something changed.
   * @throws {Error} After `destroy()`, or when called inside a transaction or a store listener.
   * @throws {unknown} What a store listener or, failing that, a subscriber threw.
   */
  #restore(direction: 'undo' | 'redo', isNotifying = true): boolean {
    this.#checkAlive();
    const manager = this.#manager;
    const isUndo = direction === 'undo';
    if (!(isUndo ? manager.canUndo() : manager.canRedo())) return false;
    let isApplied = false;
    let touched = new Set<ObjectId>();
    let isPagesChanged = false;
    try {
      this.#store.transact(this.#undoOrigin, (documentTransaction) => {
        // A step writes through Yjs, not `documentTransaction`, so it would skip the stamp a new
        // Yjs client id needs, and peers and the relay would refuse what it restores.
        this.#internals.stampBeforeWrite();
        const next = (isUndo ? manager.undoStack : manager.redoStack).at(-1);
        const extra = this.#clearedRedoSteps.asStep();
        const isOwnDeletion = this.#singleStep.deletedBySeenSteps(manager, direction, extra);
        // What Yjs applies in the step's place, in the store's transaction (`handed-step.ts`).
        const handed =
          next === undefined
            ? null
            : this.#doc.transact((yjs) => handedStep(this.#stepGuards, yjs, next, isOwnDeletion));
        if (next !== undefined && handed === null) this.#singleStep.discard(manager, direction);
        // One step only, even when it changes nothing (it is then used up).
        const step =
          next !== undefined && handed === null
            ? null
            : this.#singleStep.apply(manager, direction, extra, handed);
        // Used up: why, when others edited what it would change, with earlier parts'.
        const hasRetired = this.#definitionGuard.retire();
        const usedUp = step === null && !hasRetired ? next : undefined;
        if (usedUp !== undefined) {
          const found = this.#doc.transact((yjs) => this.#creationGuard.protection(yjs, usedUp));
          this.#protection = mergeProtections(this.#protection, found);
        }
        // Close even a used-up step's capture window so the next edit cannot merge into it.
        manager.stopCapturing();
        if (step !== null || hasRetired) {
          isApplied = true;
          // Joins the store's transaction, which is still open, to repair what Yjs left empty.
          this.#doc.transact((transaction) => {
            if (step !== null) restoreEmptiedFields(transaction, step);
            touched = touchedObjectIds(transaction, this.#objects);
            isPagesChanged = (transaction.changed as Map<unknown, unknown>).has(this.#pages);
          });
          const plan = planReferenceRepair(
            {
              get: (id) => documentTransaction.get(id),
              isPresent: (id) => this.#objects.has(id),
            },
            // The store still reads the board before the step, where what it removed still is.
            new LastKnownBoard(this.#store, this.#internals.lastKnown),
            touched,
          );
          applyReferenceRepair(documentTransaction, plan);
        }
        // Yjs pushes the inverse only when the enclosing store transaction ends; keep its
        // direction flag up until then, including retirement writes after a suppressed delete.
        if (isUndo) manager.undoing = true;
        else manager.redoing = true;
      });
    } catch (error) {
      this.#endRestore();
      // A store listener can throw after the step was committed, so subscribers still hear of
      // the new state, but the transaction's error is the one reported.
      try {
        if (isNotifying) this.#notifyIfChanged();
      } catch {
        // Dropped in favour of `error`.
      }
      throw error;
    }
    this.#endRestore();
    // After the flags are down, so the system transaction is not recorded as part of the step.
    this.#internals.repairReferences(touched, isPagesChanged);
    if (isNotifying) this.#notifyIfChanged();
    return isApplied;
  }

  /** Lowers the flags `#restore` holds up for its transaction, and forgets the kept objects. */
  #endRestore(): void {
    this.#creationGuard.end();
    this.#definitionGuard.end();
    this.#doorGuard.end();
    this.#manager.undoing = false;
    this.#manager.redoing = false;
  }

  /** Reports a step recorded from a user's change; an undo or redo reports once it ends. */
  readonly #onStepAdded = (): void => {
    if (this.#manager.undoing || this.#manager.redoing) return;
    this.#notifyIfChanged();
  };

  /**
   * Tells the subscribers when whether it can undo or redo changed.
   *
   * @throws {unknown} The first error a subscriber threw.
   */
  readonly #notifyIfChanged = (): void => {
    this.#states.notifyIfChanged(this.#manager.canUndo(), this.#manager.canRedo());
  };

  /**
   * Throws after `destroy()`.
   *
   * @throws {Error} When the history has been destroyed.
   */
  #checkAlive(): void {
    if (this.#isDestroyed) throw new Error('The undo history has been destroyed');
  }
}

/**
 * Creates a user's undo history over a store. It records, from now on,
 * the store's local transactions whose origin is the user (`{ kind: 'user', principalId }`) or
 * an agent the user operates (`{ kind: 'agent', operatorId: principalId }`), one step per
 * command, and undoes them in transactions with the origin `{ kind: 'undo', principalId }`.
 * Several histories may share a store; each sees only its own user's changes, and of those only
 * the ones whose origin carries its `historyKey`, or no key when it has none. With
 * `operatedWriters`, it also records an agent's remote updates (`operated-writes.ts`).
 *
 * @param store - A store created by `new YjsDocumentStore()`.
 * @param principalId - The user, `user:<id>`.
 * @param options - The capture window and the history key.
 * @returns The history; call `destroy()` when the user leaves the board.
 * @throws {RangeError} When the principal is not a user, or the capture window or the history
 *   key is invalid.
 * @throws {TypeError} When the store is not a `YjsDocumentStore`.
 */
export function createHistory(
  store: DocumentStore,
  principalId: PrincipalId,
  options: UndoHistoryOptions = {},
): UndoHistory {
  return new YjsUndoHistory(store, readUserPrincipal(principalId), readHistoryCapture(options));
}
