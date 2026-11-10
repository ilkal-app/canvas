import type { ObjectId } from '@canvas/schema';

import type { LayerRow } from './layer-rows.js';

/**
 * The layers tree's rows by object, and where each is in the list, kept with the rows as they
 * are spliced. Which rows are listed is exact at all times: a splice deletes the rows
 * it drops and sets the ones it adds, O(rows changed). Positions are remembered and checked
 * when read: every one below `indexedUpTo` is right, a splice lowers it to where it began (the
 * rows before a splice keep their places), and a row whose remembered position is stale is found
 * again by an identity scan of the list from there (`Array.prototype.indexOf`: no copies, no
 * writes, microseconds over 50k rows) and remembered. So a splice costs nothing here beyond its
 * own rows. Main thread.
 */
export class LayerRowIndex {
  private readonly rowById = new Map<ObjectId, LayerRow>();
  private readonly positionById = new Map<ObjectId, number>();
  private rows: readonly LayerRow[] = [];
  private indexedUpTo = 0;

  /**
   * Indexes a whole new list.
   *
   * @param rows - The rows.
   */
  reset(rows: readonly LayerRow[]): void {
    this.rowById.clear();
    this.positionById.clear();
    rows.forEach((row, index) => {
      this.rowById.set(row.id, row);
      this.positionById.set(row.id, index);
    });
    this.rows = rows;
    this.indexedUpTo = rows.length;
  }

  /**
   * Follows a splice of the list: `removed` ids are no longer listed, `added` rows are listed
   * (a row in both is listed with its new row), and every position from `changedFrom` on may
   * have moved.
   *
   * @param rows - The rows after the splice.
   * @param changedFrom - The first index the splice changed.
   * @param removed - The ids of rows it dropped.
   * @param added - The rows it added or replaced.
   */
  splice(
    rows: readonly LayerRow[],
    changedFrom: number,
    removed: readonly ObjectId[],
    added: readonly LayerRow[],
  ): void {
    for (const id of removed) {
      this.rowById.delete(id);
      this.positionById.delete(id);
    }
    for (const row of added) this.rowById.set(row.id, row);
    this.rows = rows;
    this.indexedUpTo = Math.min(this.indexedUpTo, changedFrom);
  }

  /**
   * Follows rows replaced in place (a rename, a lock): no row moved.
   *
   * @param rows - The rows after.
   * @param replaced - The new rows.
   */
  replace(rows: readonly LayerRow[], replaced: readonly LayerRow[]): void {
    for (const row of replaced) this.rowById.set(row.id, row);
    this.rows = rows;
  }

  /**
   * An object's row, if it is listed. O(1).
   *
   * @param id - The object.
   * @returns The row, or undefined inside a collapsed parent.
   */
  rowOf(id: ObjectId): LayerRow | undefined {
    return this.rowById.get(id);
  }

  /**
   * Where an object's row is in the list: O(1) while its remembered position holds, else one
   * identity scan from the first position a splice changed.
   *
   * @param id - The object.
   * @returns The index, or undefined when it is not listed.
   */
  indexOf(id: ObjectId): number | undefined {
    const row = this.rowById.get(id);
    if (row === undefined) return undefined;
    const known = this.positionById.get(id);
    if (known !== undefined && this.rows[known] === row) return known;
    const index = this.rows.indexOf(row, this.indexedUpTo);
    if (index === -1) return undefined;
    this.positionById.set(id, index);
    if (index === this.indexedUpTo) this.indexedUpTo += 1;
    return index;
  }
}
