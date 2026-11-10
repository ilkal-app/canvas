import type * as Y from 'yjs';

import type { UndoStep } from './field-guard.js';
import type { OperatedWrites } from './operated-writes.js';
import { recordLane, writeLanesOf, type WriteLane } from './write-lanes.js';

/**
 * What a step's user had in view when they made it: the document's state vector before the
 * step's first transaction (clock per Yjs client id), and the client id the step was written
 * under. A write by another client is concurrent with the step, or later, exactly when its
 * clock is at or above the vector's clock for that client.
 */
export interface CausalPast {
  /** Clock per client id before the step's first transaction; a missing client is 0. */
  readonly state: ReadonlyMap<number, number>;
  /** The document's own client id when the step was written. */
  readonly clientId: number;
  /**
   * The write lane of the history that recorded the step (`write-lanes.ts`): its key,
   * absent for an unkeyed history.
   */
  readonly historyKey?: string;
  /**
   * The other client ids' writes the history recorded as its user's (
   * `operated-writes.ts`), which the guards count as own; absent when it records none. Shared by
   * every step of the history and growing with it, as the store's own client id is own to all.
   */
  readonly operated?: OperatedWrites;
}

/** The key under which a step's {@link CausalPast} is kept in its `meta` map. */
const CAUSAL_PAST_KEY = 'canvas:causal-past';

/**
 * Records every step's causal past as `Y.UndoManager` creates it, on the step's own `meta` map,
 * for the field guard (`field-guard.ts`), including the steps an undo or redo pushes onto the
 * other stack, and the clock range each captured transaction wrote in the history's write lane
 * (`write-lanes.ts`). `Y.UndoManager` calls `captureTransaction` first when a transaction ends, then,
 * if it records the transaction, either pushes a new step (and fires `stack-item-added`) or
 * merges it into the newest step within the capture window (`stack-item-updated`, where the
 * step keeps the past of its first transaction). Stacks live only in memory, so every step
 * passes through here. Single-threaded.
 */
export class CausalPastRecorder {
  #pending: CausalPast | null = null;
  readonly #lane: WriteLane;
  readonly #operated: OperatedWrites | undefined;

  /**
   * Starts recording for one history, and notes the history on the document's write lanes.
   *
   * @param doc - The history's document; absent, it is noted with its first capture.
   * @param lane - The history's key, or `undefined` for an unkeyed history.
   * @param operated - The other client ids' writes the history records as its user's.
   */
  constructor(doc?: Y.Doc, lane?: WriteLane, operated?: OperatedWrites) {
    this.#lane = lane;
    this.#operated = operated;
    if (doc !== undefined) writeLanesOf(doc).noteHistory(lane);
  }

  /**
   * Notes the causal past of a transaction `Y.UndoManager` is about to record. Call it from
   * `captureTransaction` for each transaction it accepts.
   *
   * @param transaction - The finished transaction.
   */
  noteCaptured(transaction: Y.Transaction): void {
    this.#pending = {
      state: new Map(transaction.beforeState),
      clientId: transaction.doc.clientID,
      ...(this.#lane === undefined ? {} : { historyKey: this.#lane }),
      ...(this.#operated === undefined ? {} : { operated: this.#operated }),
    };
    if (this.#lane !== undefined) writeLanesOf(transaction.doc).noteHistory(this.#lane);
    recordLane(transaction, this.#lane);
  }

  /**
   * Gives a new step the causal past noted for its transaction. Subscribe it to the manager's
   * `stack-item-added` event.
   *
   * @param event - The event.
   * @param event.stackItem - The new step.
   */
  readonly onStepAdded = ({ stackItem }: { readonly stackItem: UndoStep }): void => {
    if (this.#pending !== null) stackItem.meta.set(CAUSAL_PAST_KEY, this.#pending);
    this.#pending = null;
  };
}

/**
 * Reads the causal past recorded for a step.
 *
 * @param step - A step of a history's `Y.UndoManager`.
 * @returns The past, or `undefined` for a step recorded without one.
 */
export function causalPastOf(step: UndoStep): CausalPast | undefined {
  return step.meta.get(CAUSAL_PAST_KEY) as CausalPast | undefined;
}
