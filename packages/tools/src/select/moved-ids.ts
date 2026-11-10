import type { ObjectId } from '@canvas/schema';

/**
 * A drag's moving ids as a set, built once per membership: the drop rules ask for it on
 * every pointer move, and the gesture hands over the same list while the selection stays.
 */
export class MovedIds {
  private ids: readonly ObjectId[] = [];
  private set: ReadonlySet<ObjectId> = new Set();

  /**
   * The ids as a set: the same set while the same list is handed over.
   *
   * @param ids - The plan's ids.
   * @returns The set.
   */
  of(ids: readonly ObjectId[]): ReadonlySet<ObjectId> {
    if (ids !== this.ids) {
      this.ids = ids;
      this.set = new Set(ids);
    }
    return this.set;
  }
}
