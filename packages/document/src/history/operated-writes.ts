import type * as Y from 'yjs';

// An agent the user operates may write from another process (the hosted MCP server's
// headless client), so its commands reach the user's store as remote updates, and Yjs never
// sends a transaction's origin: the store cannot tell them from anyone's by origin
// (`origin-ownership.ts`). The caller can tell them by the Yjs client id they were written
// under (the relay vouches which client ids an agent connection writes with), so a
// history given `operatedWriters` also records a remote transaction written under exactly one
// client id that the predicate accepts. Deletes carry no client id; they ride in the same
// update as the command's writes, since every command stamps `updatedAt`.
//
// The guards (`written-by-others.ts`) count an item of another client id as another writer's.
// The clock ranges a history recorded this way are its user's own writes, as the store's own
// client id is, so the guards count them as own: undoing an older step of the user's is not
// refused for the agent's later step, which is in the same history and is undone first.

/**
 * The caller's word on which Yjs client ids write for agents the history's user operates
 * (`UndoHistoryOptions.operatedWriters`). Asked as things happen, so it may change its answer.
 */
export interface OperatedWriters {
  /**
   * Whether a remote update written under a client id may be recorded now, as an agent's step:
   * a candidate is enough (an agent's first write arrives before the relay vouches for it).
   *
   * @param clientId - The Yjs client id.
   * @returns `true` to record it.
   */
  records(clientId: number): boolean;
  /**
   * Whether a client id is known to write for an agent the user operates (the relay vouched
   * for it): only then is a step recorded under it undone, and its writes the user's own.
   *
   * @param clientId - The Yjs client id.
   * @returns `true` when it is; `false` when it is known not to be (such a step is dropped);
   *   `undefined` while not known yet (an agent's awareness id before the relay stamped it: an
   *   undo then waits, doing nothing, and drops nothing).
   */
  owns(clientId: number): boolean | undefined;
  /**
   * Called once when the history is destroyed, to release what the caller holds for it: give
   * each history its own `OperatedWriters` when it has one.
   */
  destroy?(): void;
}

/** The ranges of one client id: sorted, disjoint, half-open `[start, end)` clock ranges. */
interface ClientRanges {
  readonly starts: number[];
  readonly ends: number[];
}

/**
 * The clock ranges of other client ids that one history recorded as its user's.
 * A client's clock only grows, so ranges almost always append. Single-threaded.
 */
export class OperatedWrites {
  readonly #byClient = new Map<number, ClientRanges>();
  readonly #owns: (clientId: number) => boolean | undefined;

  /**
   * Starts empty.
   *
   * @param owns - Whether a client id is (still) known to write for the user's agent; a range of
   *   one that is not counts as nobody's (`OperatedWriters.owns`). Every id, if absent.
   */
  constructor(owns: (clientId: number) => boolean | undefined = () => true) {
    this.#owns = owns;
  }

  /**
   * Notes the range a recorded remote transaction wrote under a client id.
   *
   * @param client - The Yjs client id.
   * @param start - The first clock of the range.
   * @param end - The clock after the last.
   */
  record(client: number, start: number, end: number): void {
    if (end <= start) return;
    let ranges = this.#byClient.get(client);
    if (ranges === undefined) {
      ranges = { starts: [], ends: [] };
      this.#byClient.set(client, ranges);
    }
    const { starts, ends } = ranges;
    const last = ends.length - 1;
    if (last >= 0 && (ends[last] ?? 0) >= start && (starts[last] ?? 0) <= start) {
      ends[last] = Math.max(ends[last] ?? end, end);
      return;
    }
    const at = firstEndingAfter(ends, start);
    starts.splice(at, 0, start);
    ends.splice(at, 0, end);
  }

  /**
   * Tells whether a clock range of a client lies wholly inside recorded ranges.
   *
   * @param client - The Yjs client id.
   * @param start - The first clock of the range.
   * @param end - The clock after the last.
   * @returns `true` when the history recorded every clock of it, under an id it still owns.
   */
  covers(client: number, start: number, end: number): boolean {
    const ranges = this.#byClient.get(client);
    if (ranges === undefined || this.#owns(client) !== true) return false;
    let from = start;
    const { starts, ends } = ranges;
    for (let at = firstEndingAfter(ends, from); at < ends.length && from < end; at += 1) {
      if ((starts[at] ?? end) > from) return false;
      from = ends[at] ?? end;
    }
    return from >= end;
  }
}

/**
 * The index of the first range whose end is after a clock, in a sorted array of ends.
 *
 * @param ends - The ranges' ends, ascending.
 * @param clock - The clock.
 * @returns The index, `ends.length` when there is none.
 */
function firstEndingAfter(ends: readonly number[], clock: number): number {
  let low = 0;
  let high = ends.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((ends[middle] ?? 0) > clock) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The one client id a remote transaction wrote under, when there is exactly one and it writes
 * for an agent the user operates; a transaction that wrote under several, or under none (a
 * delete alone, which nobody can be told from), is nobody's.
 *
 * @param transaction - A finished remote transaction.
 * @param isOperated - Whether a client id writes for an agent the user operates.
 * @returns The client id, or `undefined`.
 */
export function operatedWriterOf(
  transaction: Y.Transaction,
  isOperated: (clientId: number) => boolean,
): number | undefined {
  let writer: number | undefined;
  for (const [client, end] of transaction.afterState) {
    if (end <= (transaction.beforeState.get(client) ?? 0)) continue;
    if (writer !== undefined) return undefined;
    writer = client;
  }
  return writer !== undefined && isOperated(writer) ? writer : undefined;
}

/**
 * What a history records of the remote writes of agents its user operates: it finds
 * the agent's client id in a remote transaction, notes the range it wrote (`writes`), keeps the
 * transaction a step of its own, merging with neither the user's step before it nor the one
 * after, whatever the capture window, and tags the step with the id. A step recorded under a
 * candidate id the caller never came to own (another connection wrote under an agent's
 * awareness id before it did) is dropped unapplied when it comes to be undone.
 */
export class OperatedCapture {
  /** The ranges recorded, which the guards count as the user's own while the id is owned. */
  readonly writes: OperatedWrites;
  readonly #writers: OperatedWriters;
  /** The writer of the step `Y.UndoManager` is about to add, when it is an agent's. */
  #pendingWriter: number | undefined;

  /**
   * Starts with the caller's word on whose client ids write for the user's agents.
   *
   * @param writers - The caller's word.
   */
  constructor(writers: OperatedWriters) {
    this.#writers = writers;
    this.writes = new OperatedWrites((clientId) => writers.owns(clientId));
  }

  /**
   * The capture for a history's options.
   *
   * @param isOperated - The history's `operatedWriters`, if any.
   * @returns The capture, or `undefined` for a history that records no agent's remote writes.
   */
  static of(isOperated: OperatedWriters | undefined): OperatedCapture | undefined {
    return isOperated === undefined ? undefined : new OperatedCapture(isOperated);
  }

  /** Releases the caller's writers (`OperatedWriters.destroy`), when the history is destroyed. */
  destroy(): void {
    this.#writers.destroy?.();
  }

  /**
   * Whether the history records a transaction as an agent's: one of the store's remote updates
   * (whose origin the store issued, a plain object `Y.UndoManager` tracks) that changed what the
   * history covers, written under one client id of an agent the user operates. If so, notes the
   * range it wrote and ends the capture window, so it does not merge into the step before it.
   * Call it from `captureTransaction`, only for a transaction that is not an undo or a redo.
   *
   * @param transaction - The finished Yjs transaction.
   * @param manager - The history's undo manager.
   * @returns `true` to record it.
   */
  captures(transaction: Y.Transaction, manager: Y.UndoManager): boolean {
    if (transaction.local) return false;
    const { origin } = transaction as { readonly origin: unknown };
    if (typeof origin !== 'object' || origin?.constructor !== Object) return false;
    const { scope } = manager;
    if (![...transaction.changedParentTypes.keys()].some((type) => scope.includes(type))) {
      return false;
    }
    const writer = operatedWriterOf(transaction, (clientId) => this.#writers.records(clientId));
    if (writer === undefined) return false;
    const start = transaction.beforeState.get(writer) ?? 0;
    this.writes.record(writer, start, transaction.afterState.get(writer) ?? start);
    manager.stopCapturing();
    this.#pendingWriter = writer;
    return true;
  }

  /**
   * Follows a history's manager: each agent's step Yjs adds is tagged with its writer and ends
   * its capture window, so the user's next change does not merge into it.
   *
   * @param manager - The history's undo manager.
   */
  listen(manager: Y.UndoManager): void {
    manager.on(
      'stack-item-added',
      ({ stackItem }: { readonly stackItem: Y.UndoManager['undoStack'][number] }) => {
        const writer = this.#pendingWriter;
        if (writer === undefined) return;
        this.#pendingWriter = undefined;
        stackItem.meta.set(WRITER_KEY, writer);
        manager.stopCapturing();
      },
    );
  }

  /**
   * Gets the undo stack ready for an undo: drops, unapplied, the newest steps recorded under an
   * id the caller disowns (the relay vouched it for someone else: not the user's agent's), and
   * tells whether the newest step left is one whose id the caller does not know yet (the relay
   * has not stamped it), which the undo must wait for. Leaves the redo stack as it is.
   *
   * @param manager - The history's undo manager.
   * @param direction - The restore about to run; nothing is done before a redo.
   * @returns Whether it dropped any, and whether the undo must wait.
   */
  prepareUndo(
    manager: Y.UndoManager,
    direction: 'undo' | 'redo' = 'undo',
  ): { readonly isDropped: boolean; readonly isPending: boolean } {
    let isDropped = false;
    while (direction === 'undo') {
      const isOwned = this.#ownsStep(manager.undoStack.at(-1));
      if (isOwned !== false) return { isDropped, isPending: isOwned === undefined };
      manager.undoStack = manager.undoStack.slice(0, -1);
      isDropped = true;
    }
    return { isDropped, isPending: false };
  }

  /**
   * Whether there is a step to undo once the newest disowned ones are left out, without
   * dropping them ({@link OperatedCapture.prepareUndo} does), so an undo control is not left on
   * for none.
   *
   * @param manager - The history's undo manager.
   * @returns `true` when there is.
   */
  canUndo(manager: Y.UndoManager): boolean {
    return manager.undoStack.some((step) => this.#ownsStep(step) !== false);
  }

  /**
   * Whether the caller owns a step's writer.
   *
   * @param step - A step, if any.
   * @returns The caller's word on the agent's step's writer; `true` for a step of the user's own,
   *   `false` for none.
   */
  #ownsStep(step: Y.UndoManager['undoStack'][number] | undefined): boolean | undefined {
    if (step === undefined) return true;
    const writer = step.meta.get(WRITER_KEY) as number | undefined;
    return writer === undefined || this.#writers.owns(writer);
  }
}

/** The key under which an agent's step keeps its writer's client id in its `meta` map. */
const WRITER_KEY = 'canvas:operated-writer';
