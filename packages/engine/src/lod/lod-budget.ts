// The per-update cap on level-of-detail form changes, kept apart from `LevelOfDetail`
// for its size limit.
import type { LodBudget, LodEntry } from './lod-pass-state.js';

/** Options for a `LevelOfDetail`. */
export interface LevelOfDetailOptions {
  /**
   * The most form changes one update makes: the rest keep their form and change first
   * at the next update (`LevelOfDetail.hasPendingChanges`). An integer of at least 1, or
   * `Infinity` (the default) for no cap. A first form is not a change.
   */
  readonly changesPerFrame?: number | undefined;
}

const NO_ENTRIES: readonly LodEntry[] = [];

/** Counts an update's form changes and keeps the ones past the cap for the next update. */
export class LodChangeBudget implements LodBudget {
  /** Form changes the current update may still make. */
  remaining = Infinity;
  private readonly perUpdate: number;
  /** Entries whose change the cap deferred, oldest first. */
  private readonly deferred = new Set<LodEntry>();

  /**
   * Creates the budget.
   *
   * @param changesPerFrame - The cap; default `Infinity`.
   * @throws {RangeError} When it is neither an integer of at least 1 nor Infinity.
   */
  constructor(changesPerFrame = Infinity) {
    if (
      changesPerFrame !== Infinity &&
      !(Number.isInteger(changesPerFrame) && changesPerFrame >= 1)
    )
      throw new RangeError(
        `changesPerFrame must be an integer ≥ 1 or Infinity; got ${String(changesPerFrame)}.`,
      );
    this.perUpdate = changesPerFrame;
  }

  /**
   * Starts an update: refills the allowance and hands back the deferred entries, to be
   * evaluated first (each is deferred again if the allowance runs out).
   *
   * @returns The deferred entries, oldest first.
   */
  begin(): readonly LodEntry[] {
    this.remaining = this.perUpdate;
    if (this.deferred.size === 0) return NO_ENTRIES;
    const carried = [...this.deferred];
    this.deferred.clear();
    return carried;
  }

  /**
   * Keeps an entry whose change the cap refused for the next update.
   *
   * @param entry - The entry.
   */
  defer(entry: LodEntry): void {
    this.deferred.add(entry);
  }

  /**
   * Forgets an entry its pass no longer draws.
   *
   * @param entry - The entry.
   */
  forget(entry: LodEntry): void {
    this.deferred.delete(entry);
  }

  /**
   * Whether some changes wait for the next update.
   *
   * @returns True while some do.
   */
  get hasPending(): boolean {
    return this.deferred.size > 0;
  }
}
