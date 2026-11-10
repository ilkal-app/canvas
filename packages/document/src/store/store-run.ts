import type { BoardObject } from '@canvas/schema';

import type { ChangeSet } from './document-store.js';

// A store run: one writer holds the document across browser tasks, so a large
// command's parts, applied a task each, are never interleaved with anyone else's write. While a
// run is open every mutation entry of the store throws `StoreBusyError` before it changes
// anything, unless it is made inside the run's synchronous `enter` scope; reads stay allowed and
// see the parts applied so far, each a valid board.

/** Why a write inside a transaction or a listener callback is refused: transactions do not nest. */
export const NESTED_TRANSACTION_MESSAGE =
  'A transaction is already running: transactions do not nest, and listeners must not ' +
  'write synchronously (schedule the write instead)';

/**
 * A mutation was refused because another writer's run holds the store: a large command
 * or undo applying its parts across tasks. Retry once `whenIdle` resolves.
 */
export class StoreBusyError extends Error {
  /**
   * Makes the error.
   *
   * @param message - What was refused.
   */
  constructor(message = 'The document is busy: a large change is being applied') {
    super(message);
    this.name = 'StoreBusyError';
  }
}

/** The store was destroyed while a caller waited for it to become idle (`whenIdle`). */
export class StoreDestroyedError extends Error {
  /** Makes the error. */
  constructor() {
    super('The document store has been destroyed');
    this.name = 'StoreDestroyedError';
  }
}

/**
 * A stepped run stopped before its last part: the parts committed before it stay on the
 * board, as one undo step, and peers have them. A stepped undo or redo (`UndoHistory.startRestore`)
 * stops the same way, its committed parts restored.
 */
export class RunStoppedError extends Error {
  /** How many parts were committed, a part whose listener threw after its commit included. */
  readonly committedParts: number;
  /** What the committed parts changed, in order; `undefined` for an undo or redo. */
  readonly changes: ChangeSet | undefined;
  /** How many parts the run planned; `undefined` when it stopped while still planning. */
  readonly plannedParts: number | undefined;

  /**
   * Makes the error.
   *
   * @param committedParts - How many parts were committed.
   * @param changes - What they changed, for a command; `undefined` for an undo or redo.
   * @param cause - Why the run stopped.
   * @param plannedParts - How many parts it planned, when it got that far.
   */
  constructor(
    committedParts: number,
    changes: ChangeSet | undefined,
    cause: unknown,
    plannedParts?: number,
  ) {
    super(`The change stopped after ${String(committedParts)} of its parts`, { cause });
    this.name = 'RunStoppedError';
    this.committedParts = committedParts;
    this.changes = changes;
    this.plannedParts = plannedParts;
  }
}

/** Why a run was asked to stop before its next part (`RunnableStore.requestStop`). */
export type RunStopReason = 'revoked' | 'inbound-backlog';

/**
 * A run was asked to stop before its next part: the writer lost write access
 * (`revoked`), or the collab client holds more inbound updates than it keeps (`inbound-backlog`).
 * A stopped run's `RunStoppedError` carries it as its `cause`.
 */
export class RunStopRequest extends Error {
  /** Why. */
  readonly reason: RunStopReason;

  /**
   * Makes the request.
   *
   * @param reason - Why the run is to stop.
   */
  constructor(reason: RunStopReason) {
    super(`The change was stopped: ${reason}`);
    this.name = 'RunStopRequest';
    this.reason = reason;
  }
}

/**
 * An open run on a store (`YjsDocumentStore.beginRun`): only work inside its `enter` may mutate
 * the store until `close`.
 */
export interface StoreRun {
  /**
   * Runs `work` with the run's authority: every store mutation it makes synchronously is allowed.
   * The authority ends when `work` returns or throws, so a listener the store calls later, even in
   * the same task, holds none.
   *
   * @param work - The writes.
   * @returns What `work` returned.
   * @throws {Error} After `close()`.
   */
  enter<Result>(work: () => Result): Result;
  /** Ends the run: the store takes other writers again, and `whenIdle` waiters resolve. */
  close(): void;
  /**
   * Reports the run's progress to whoever follows the store's runs (`subscribeStoreRuns`): the
   * parts committed so far of all its parts. Nothing after `close()`.
   *
   * @param done - The parts committed.
   * @param total - All its parts.
   */
  progress(done: number, total: number): void;
  /**
   * Throws when the run was asked to stop (`RunnableStore.requestStop`); a stepped run calls it
   * before each later part.
   *
   * @throws {RunStopRequest} When a stop was requested.
   */
  checkStop(): void;
  /**
   * Marks new objects as validated whole, as the store validates a write: a write of
   * one of these very objects inside the run, creating its id with its page already settled, is
   * not validated again. Forgotten when the run closes.
   *
   * @param objects - The objects, each the result of `validateObject` with nothing stored.
   */
  certify(objects: Iterable<BoardObject>): void;
}

/** A store that one writer can hold across tasks: `YjsDocumentStore`. */
export interface RunnableStore {
  /**
   * Opens a run: until it is closed, every mutation of the store (`transact`, `applyUpdate`,
   * `applyUpdateInSteps`, `setRepairMode`, any history's undo or redo) throws `StoreBusyError`
   * unless made inside the run's `enter`. Reads stay allowed.
   *
   * @returns The run.
   * @throws {StoreBusyError} When a run is already open.
   * @throws {Error} Inside a transaction or a listener, or after `destroy()`.
   */
  beginRun(): StoreRun;
  /**
   * Resolves when no run holds the store: at once when none is open.
   *
   * @returns The promise; it rejects with `StoreDestroyedError` when the store is destroyed
   *   first, or was already.
   */
  whenIdle(): Promise<void>;
  /** Whether a run holds the store now. */
  readonly isRunning: boolean;
  /**
   * Asks the open run to stop before its next part: the parts it committed stay. Nothing when no
   * run is open; the request ends with the run.
   *
   * @param reason - Why.
   */
  requestStop(reason: RunStopReason): void;
}

/** The open run: how deep its authority is entered, its stop request, its certified objects. */
interface OpenRun {
  depth: number;
  stop: RunStopRequest | undefined;
  readonly certified: WeakSet<BoardObject>;
}

/** What a waiter of `whenIdle` is settled with. */
interface IdleWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/** How far a stepped run has got (`StoreRun.progress`). */
export interface StoreRunProgress {
  /** The parts committed. */
  readonly done: number;
  /** All its parts. */
  readonly total: number;
}

/** A store's open run as its followers see it (`subscribeStoreRuns`). */
export interface StoreRunState {
  /** Its progress as last reported; undefined before any report. */
  readonly progress: StoreRunProgress | undefined;
}

/**
 * One store's run state: at most one run, its entered depth, who waits for its end, and who
 * follows its runs.
 */
export class RunGate {
  #open: OpenRun | undefined;
  #waiters: IdleWaiter[] = [];
  #isDestroyed = false;
  #state: StoreRunState | undefined;
  readonly #listeners = new Set<(state: StoreRunState | undefined) => void>();

  /**
   * The open run's state.
   *
   * @returns It, or `undefined` while no run is open.
   */
  get state(): StoreRunState | undefined {
    return this.#state;
  }

  /**
   * Follows the store's runs: told when one opens, on each progress report, and when it closes;
   * not at once. Nothing after the store is destroyed.
   *
   * @param listener - Told the state, or `undefined` once the run closed.
   * @returns A function that stops following.
   */
  subscribe(listener: (state: StoreRunState | undefined) => void): () => void {
    if (this.#isDestroyed) return () => undefined;
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Opens a run.
   *
   * @returns The run.
   * @throws {StoreBusyError} When a run is already open.
   */
  begin(): StoreRun {
    if (this.#open !== undefined) throw new StoreBusyError();
    const open: OpenRun = { depth: 0, stop: undefined, certified: new WeakSet() };
    this.#open = open;
    let isClosed = false;
    this.#tell({ progress: undefined });
    return {
      enter: <Result>(work: () => Result): Result => {
        if (isClosed) throw new Error('The store run has been closed');
        open.depth += 1;
        try {
          return work();
        } finally {
          open.depth -= 1;
        }
      },
      close: () => {
        if (isClosed) return;
        isClosed = true;
        // Only one run is open at a time, so it is this one.
        this.#open = undefined;
        const waiters = this.#waiters;
        this.#waiters = [];
        for (const waiter of waiters) waiter.resolve();
        this.#tell(undefined);
      },
      progress: (done, total) => {
        if (!isClosed) this.#tell({ progress: { done, total } });
      },
      checkStop: () => {
        if (open.stop !== undefined) throw open.stop;
      },
      certify: (objects) => {
        if (isClosed) return;
        for (const object of objects) open.certified.add(object);
      },
    };
  }

  /**
   * Whether a write is of an object the open run certified (`StoreRun.certify`), made inside it.
   *
   * @param object - The object written.
   * @returns True when it may skip the store's validation.
   */
  isCertified(object: BoardObject): boolean {
    const open = this.#open;
    return open !== undefined && open.depth > 0 && open.certified.has(object);
  }

  /**
   * Whether the store was destroyed.
   *
   * @returns True once it was.
   */
  get isDestroyed(): boolean {
    return this.#isDestroyed;
  }

  /**
   * Whether a run is open.
   *
   * @returns `true` while a run holds the store.
   */
  get isOpen(): boolean {
    return this.#open !== undefined;
  }

  /**
   * Asks the open run to stop before its next part; the first reason given stands.
   *
   * @param reason - Why.
   */
  requestStop(reason: RunStopReason): void {
    if (this.#open !== undefined) this.#open.stop ??= new RunStopRequest(reason);
  }

  /**
   * Refuses a mutation made outside an open run's `enter`.
   *
   * @throws {StoreBusyError} When a run is open and not entered.
   */
  check(): void {
    if (this.#open !== undefined && this.#open.depth === 0) throw new StoreBusyError();
  }

  /**
   * Resolves when no run holds the store: at once when none is open.
   *
   * @returns The promise; it rejects with `StoreDestroyedError` if the store is destroyed first.
   */
  whenIdle(): Promise<void> {
    if (this.#isDestroyed) return Promise.reject(new StoreDestroyedError());
    if (this.#open === undefined) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  /** Rejects every waiter and drops every follower: the store was destroyed. */
  destroy(): void {
    this.#isDestroyed = true;
    this.#listeners.clear();
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) waiter.reject(new StoreDestroyedError());
  }

  /**
   * Records the run's state and tells the followers. A follower that throws is reported in a
   * later task, not here: the run it was told of still opens or closes, and every other follower
   * is told.
   *
   * @param state - The state, or `undefined` once closed.
   */
  #tell(state: StoreRunState | undefined): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) {
      try {
        listener(state);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
