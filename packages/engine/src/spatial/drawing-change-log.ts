import type { ObjectId } from '@canvas/schema';

/** How many changes the log keeps at least; a reader further behind learns that it cannot know. */
const DRAWING_CHANGE_LOG_LIMIT = 4096;

/**
 * The revisions of asynchronous drawing bounds (`SceneSpatialIndex.drawingBoundsRevision`) and,
 * for the recent ones, which object each was, so z-order segments can repair the
 * intervals of the objects whose boxes changed instead of planning in full. A change that moved
 * many boxes at once (a retained move beginning or ending) is logged as unknown.
 */
export class DrawingChangeLog {
  private current = 0;
  /** Each logged revision's object, or undefined for an unknown change; oldest first. */
  private readonly ids: (ObjectId | undefined)[] = [];
  /** The revision of `ids[0]`. */
  private first = 1;

  /**
   * The latest revision.
   *
   * @returns It; 0 before any change.
   */
  get revision(): number {
    return this.current;
  }

  /**
   * Logs one object's drawing box changing.
   *
   * @param id - The object.
   */
  note(id: ObjectId): void {
    this.push(id);
  }

  /** Logs a change to boxes that names no one object. */
  noteUnknown(): void {
    this.push(undefined);
  }

  /**
   * The objects whose drawing boxes changed after a revision.
   *
   * @param revision - The reader's last revision.
   * @returns Their ids (repeats possible), or undefined when an unknown change or one no longer
   *   logged lies between.
   */
  since(revision: number): readonly ObjectId[] | undefined {
    if (revision >= this.current) return [];
    if (revision + 1 < this.first) return undefined;
    const changed: ObjectId[] = [];
    for (let index = revision + 1 - this.first; index < this.ids.length; index += 1) {
      const id = this.ids[index];
      if (id === undefined) return undefined;
      changed.push(id);
    }
    return changed;
  }

  private push(id: ObjectId | undefined): void {
    this.current += 1;
    this.ids.push(id);
    // Trimmed by halves, so each change costs O(1) amortised.
    if (this.ids.length >= 2 * DRAWING_CHANGE_LOG_LIMIT) {
      this.ids.splice(0, DRAWING_CHANGE_LOG_LIMIT);
      this.first += DRAWING_CHANGE_LOG_LIMIT;
    }
  }
}
