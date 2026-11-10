import type { ObjectId } from '@canvas/schema';

/** The texts a frame rewrites at most on a level-of-detail change. */
export const DEFAULT_DETAIL_REWRITES_PER_FRAME = 1_000;

/**
 * The texts whose level of detail changed between glyphs and greek bars, rewritten a frame's
 * budget at a time, oldest first: a zoom across the threshold at 50k changed every
 * visible text's records in one frame (tens of ms). A text not yet rewritten draws as before:
 * greek bars a few frames longer when zooming in, glyphs when zooming out. Rendering thread.
 */
export class TextDetailQueue {
  private readonly queued = new Set<ObjectId>();

  /**
   * Creates an empty queue.
   *
   * @param budget - Texts a frame rewrites at most, at least 1 (`Infinity`: all at once); default
   *   {@link DEFAULT_DETAIL_REWRITES_PER_FRAME}.
   * @param requestFrame - Asks for another frame while texts wait.
   * @throws {RangeError} When the budget is not a whole number of at least 1 or `Infinity`: a
   *   queue that may take nothing a frame would never drain, and its text never settle.
   */
  constructor(
    private readonly budget = DEFAULT_DETAIL_REWRITES_PER_FRAME,
    private readonly requestFrame: () => void = () => undefined,
  ) {
    if (!(budget === Infinity || (Number.isInteger(budget) && budget >= 1))) {
      throw new RangeError(
        `detailRewritesPerFrame must be a whole number ≥ 1 or Infinity; got ${String(budget)}.`,
      );
    }
  }

  /**
   * The texts waiting.
   *
   * @returns Their ids, oldest first.
   */
  get ids(): ReadonlySet<ObjectId> {
    return this.queued;
  }

  /**
   * Queues texts whose form changed.
   *
   * @param ids - The texts.
   */
  add(ids: Iterable<ObjectId>): void {
    for (const id of ids) this.queued.add(id);
  }

  /**
   * Takes this frame's share: up to the budget of queued texts still drawn in the other form. A
   * text back in the form it is drawn in, or gone, leaves the queue for free.
   *
   * @param isDrawnInOtherForm - Whether a text's records differ from its form now.
   * @param into - Collects the texts to rewrite.
   * @returns Whether texts still wait; then another frame has been asked for.
   */
  take(isDrawnInOtherForm: (id: ObjectId) => boolean, into: Set<ObjectId>): boolean {
    let taken = 0;
    for (const id of this.queued) {
      if (taken >= this.budget) break;
      this.queued.delete(id);
      if (!isDrawnInOtherForm(id)) continue;
      into.add(id);
      taken += 1;
    }
    if (this.queued.size === 0) return false;
    this.requestFrame();
    return true;
  }

  /**
   * Forgets a text.
   *
   * @param id - The text.
   */
  delete(id: ObjectId): void {
    this.queued.delete(id);
  }

  /** Forgets every text. */
  clear(): void {
    this.queued.clear();
  }
}
