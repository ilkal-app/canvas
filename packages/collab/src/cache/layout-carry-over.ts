import { SYSTEM_ORIGIN, type DocumentStore } from '@canvas/document';

import { reportAsynchronously } from '../errors/report-asynchronously.js';

import { buildRecoveryCandidate } from './cache-recovery-candidate.js';
import type { EarlierLayoutBoard, EarlierLayoutCaches } from './document-cache.js';
import { findLayoutConverter, type LayoutConverters } from './layout-converters.js';
import { findUnsentChanges } from './unsent-changes.js';

/**
 * Edits an earlier layout's build cached for a board that this build could not carry over:
 * the person is told, and the earlier copy is kept until they dismiss it.
 */
export interface StrandedEdits {
  /** Retained sources cannot be dismissed; this reads their latest retained bytes for export. */
  readonly exportSource?: () => Promise<EarlierLayoutBoard>;
  /** The board. */
  readonly boardId: string;
  /** Where the copy is kept (`EarlierLayoutBoard.source`); what the person dismisses. */
  readonly source: string;
  /** The stored layout the edits were written in. */
  readonly fromLayoutVersion: number;
  /** The stored layout this build writes. */
  readonly toLayoutVersion: number;
  /**
   * How many cached records hold edits the relay lacks (`UnsentChanges.count`); every record
   * when the copy cannot be read (which is not reported to `onError`: the person is told).
   */
  readonly unsentChangeCount: number;
}

/** What a {@link LayoutCarryOver} works on. */
export interface LayoutCarryOverOptions {
  /** The board's store: the comparison's reference once synced, and where carried edits go. */
  readonly store: DocumentStore;
  /** The board. */
  readonly boardId: string;
  /** The earlier writer layouts' copies of boards, keyed like the board's cache. */
  readonly earlierLayouts: EarlierLayoutCaches;
  /**
   * Stores carried edits in the board's current cache (its `append`) and resolves once they are
   * stored, rejecting when they are not (a full quota). The earlier copy is deleted only after
   * this resolves: the store's own update event leaves out content it holds pending (structs
   * whose dependencies are missing, deletions of items it lacks), so the cache binding alone
   * would not store it.
   */
  readonly storeDurably: (update: Uint8Array) => Promise<void>;
  /** The converters by layout bump; `DEFAULT_LAYOUT_CONVERTERS` by default. */
  readonly converters?: LayoutConverters;
  /** Receives failures to read or delete an earlier copy; rethrown from a microtask by default. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Carries a board's unsent edits over a stored-layout bump, once per open. A new
 * build's cache never restores an earlier layout's copy, so {@link LayoutCarryOver.run}, called
 * once the store holds the relay's board (or, with no relay, the board as this device has it),
 * compares every earlier copy of the board against the store (`findUnsentChanges`). A copy
 * holding nothing the store lacks is deleted, silently (a pre- copy is left as it is).
 * Otherwise, when edits may be carried and a converter exists for the bump (never for a
 * pre- copy), they are converted, applied to the store (the client sends them),
 * stored in the current cache by `storeDurably`, and only then is the copy deleted. Else the
 * copy is kept and reported in {@link LayoutCarryOver.stranded} until the person dismisses it.
 * A delete removes only the records the pass read. No timer and no polling: one pass per open.
 * Main thread.
 */
export class LayoutCarryOver {
  readonly #options: LayoutCarryOverOptions;
  readonly #onError: (error: unknown) => void;
  readonly #listeners = new Set<() => void>();
  #stranded: readonly StrandedEdits[] = Object.freeze([]);
  /** The copies behind {@link LayoutCarryOver.stranded}, by source, for their dismissal. */
  readonly #strandedCopies = new Map<string, EarlierLayoutBoard>();
  #run: Promise<void> | undefined;
  #isDestroyed = false;

  /**
   * Prepares the carry-over; nothing is read before {@link LayoutCarryOver.run}.
   *
   * @param options - The store, board, earlier copies, flush and converters.
   */
  constructor(options: LayoutCarryOverOptions) {
    this.#options = options;
    this.#onError = options.onError ?? reportAsynchronously;
  }

  /**
   * The edits that could not be carried over and are kept for the person to dismiss.
   *
   * @returns A frozen list, oldest layout first; the same array until it changes.
   */
  get stranded(): readonly StrandedEdits[] {
    return this.#stranded;
  }

  /**
   * Calls `listener` whenever {@link LayoutCarryOver.stranded} changes.
   *
   * @param listener - Called with no arguments.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Checks every earlier copy of the board once; later calls return the first pass.
   *
   * @param canCarry - Whether unsent edits may be put into the store (`false` for a read-only
   *   connection, whose edits the relay refuses: they are reported and kept instead).
   * @returns Resolves once the pass is done; never rejects (failures go to `onError`).
   */
  run(canCarry: boolean): Promise<void> {
    this.#run ??= this.#pass(canCarry).catch((error: unknown) => {
      if (!this.#isDestroyed) this.#onError(error);
    });
    return this.#run;
  }

  /**
   * Lets the person drop edits that could not be carried over: deletes the records of that copy
   * the pass read (records stored since stay for the next open) and stops reporting it.
   *
   * @param source - The stranded edits' source (`StrandedEdits.source`).
   * @returns Resolves once the copy is gone; never rejects (a failure goes to `onError` and the
   *   edits stay reported).
   */
  async dismiss(source: string): Promise<void> {
    const { earlierLayouts, boardId } = this.#options;
    const copy = this.#strandedCopies.get(source);
    if (copy === undefined || copy.replayPolicy === 'manual' || copy.shouldRecover === true) return;
    try {
      await earlierLayouts.delete(boardId, copy);
    } catch (error: unknown) {
      this.#onError(error);
      return;
    }
    this.#strandedCopies.delete(source);
    this.#setStranded(this.#stranded.filter((edits) => edits.source !== source));
  }

  /** Stops reporting: a pass still running changes nothing more and tells no one. */
  destroy(): void {
    this.#isDestroyed = true;
    this.#listeners.clear();
  }

  /**
   * Reads the earlier copies and settles each.
   *
   * @param canCarry - Whether unsent edits may be put into the store.
   */
  async #pass(canCarry: boolean): Promise<void> {
    const { earlierLayouts, boardId } = this.#options;
    const stranded: StrandedEdits[] = [];
    for (const earlier of await earlierLayouts.find(boardId)) {
      if (this.#isDestroyed) return;
      const edits = await this.#settle(earlier, canCarry);
      if (edits !== undefined) {
        stranded.push(edits);
        this.#strandedCopies.set(edits.source, earlier);
      }
    }
    if (!this.#isDestroyed && stranded.length > 0) this.#setStranded(stranded);
  }

  /**
   * Deletes a copy holding nothing unsent, carries one that can be carried, or reports it.
   *
   * @param earlier - One earlier layout's copy of the board.
   * @param canCarry - Whether unsent edits may be put into the store.
   * @returns The stranded edits, or `undefined` once the copy is settled.
   */
  async #settle(
    earlier: EarlierLayoutBoard,
    canCarry: boolean,
  ): Promise<StrandedEdits | undefined> {
    const { store, boardId, earlierLayouts, storeDurably, converters } = this.#options;
    const toLayoutVersion = earlierLayouts.writerLayoutVersion;
    const stranded = (count: number): StrandedEdits => ({
      boardId,
      source: earlier.source,
      fromLayoutVersion: earlier.layoutVersion,
      toLayoutVersion,
      unsentChangeCount: count,
      ...(earlier.replayPolicy === 'manual' || earlier.shouldRecover === true
        ? {
            exportSource: async () =>
              (await earlierLayouts.find(boardId)).find((copy) => copy.source === earlier.source) ??
              earlier,
          }
        : {}),
    });
    const { board } = earlier;
    if (earlier.replayPolicy === 'manual')
      return stranded(board.updates.length + (board.snapshot === undefined ? 0 : 1));
    if (earlier.shouldRecover === true) {
      const count = await this.#recover(earlier, canCarry);
      return count === 0 ? undefined : stranded(count);
    }
    let unsent;
    try {
      unsent = findUnsentChanges(board, store);
    } catch {
      return stranded(board.updates.length + (board.snapshot === undefined ? 0 : 1));
    }
    if (unsent.update === undefined) {
      if (!earlier.isPreLayoutCache) await earlierLayouts.delete(boardId, earlier);
      return undefined;
    }
    const convert =
      canCarry && !earlier.isPreLayoutCache
        ? findLayoutConverter(earlier.layoutVersion, toLayoutVersion, converters)
        : undefined;
    if (convert === undefined) return stranded(unsent.count);
    try {
      const converted = convert(unsent.update);
      store.applyUpdate(converted, SYSTEM_ORIGIN);
      await storeDurably(converted);
    } catch (error: unknown) {
      this.#onError(error);
      return stranded(unsent.count);
    }
    await earlierLayouts.delete(boardId, earlier);
    return undefined;
  }

  /**
   * Proves whole records from retained storage before they can affect a live store. The
   * original database remains writable by older tabs and is never changed here.
   *
   * @param earlier - Original cache records, possibly including poisoned generations.
   * @param canCarry - Whether the caller may apply edits.
   * @returns Number of records that remain stranded.
   */
  async #recover(earlier: EarlierLayoutBoard, canCarry: boolean): Promise<number> {
    const { store, storeDurably, converters, earlierLayouts } = this.#options;
    const records =
      earlier.board.snapshot === undefined
        ? [...earlier.board.updates]
        : [earlier.board.snapshot, ...earlier.board.updates];
    const convert =
      earlier.layoutVersion === earlierLayouts.writerLayoutVersion
        ? (bytes: Uint8Array) => bytes
        : findLayoutConverter(
            earlier.layoutVersion,
            earlierLayouts.writerLayoutVersion,
            converters,
          );
    if (!canCarry || convert === undefined) return records.length;
    try {
      const candidate = buildRecoveryCandidate(store.encodeState(), records.map(convert));
      for (const update of candidate.updates) {
        await storeDurably(update);
        if (this.#isDestroyed) return records.length;
        store.applyUpdate(update, SYSTEM_ORIGIN);
      }
      return candidate.unresolved.length;
    } catch (error: unknown) {
      this.#onError(error);
      return records.length;
    }
  }

  /**
   * Replaces the stranded edits and tells listeners.
   *
   * @param stranded - The new list.
   */
  #setStranded(stranded: readonly StrandedEdits[]): void {
    this.#stranded = Object.freeze([...stranded]);
    for (const listener of [...this.#listeners]) listener();
  }
}
