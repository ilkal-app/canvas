import type { WorldBounds } from '../../camera/camera.js';
import { intersectsBounds } from '../../spatial/bounds.js';

/** The most grid cells along either axis. */
const MAX_CELLS_PER_AXIS = 256;

/** A box over more cells than this is kept in the list every query checks instead. */
const MAX_CELLS_PER_BOX = 64;

/** One object of the segment being gathered: its world box and the highest pass it draws in. */
interface GridEntry {
  readonly bounds: WorldBounds;
  readonly highestPass: number;
}

/**
 * The objects of the z-order segment being gathered, bucketed by world box on a uniform grid,
 * so `assignSegments` can ask whether an occluder would cover anything that a later pass
 * of the segment draws: only then does it need a segment of its own. The grid spans the
 * visible objects' boxes, about √n cells a side (at most 256); a box over more than 64 cells,
 * and an object with no box (drawn, but not indexed), goes to a list every query checks. Adding
 * is deferred until a query needs the cells (a segment no occluder tests costs nothing but a
 * list), then O(cells covered); a query reads the cells its box covers. `clear` empties only
 * the cells used, so starting a segment costs what the last one held. CPU-only; the frame's thread.
 */
export class SegmentOverlapGrid {
  private readonly columns: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  /** Per cell, its entries; a cell's list is made when first used and kept, emptied. */
  private readonly cells = new Map<number, GridEntry[]>();
  /** Entries added since the last query, bucketed only once a query needs them. */
  private readonly pending: GridEntry[] = [];
  /** The cells' lists holding entries, to empty on `clear`. */
  private readonly usedLists: GridEntry[][] = [];
  /** Entries every query checks: boxes over many cells. */
  private readonly wide: GridEntry[] = [];
  /** The highest pass of any object added without a box, or −1. */
  private unboundedHighest = -1;

  /**
   * Creates an empty grid.
   *
   * @param extent - The union of the boxes that may be added, world units; `undefined` when
   *   none has one (every entry then goes to the list every query checks).
   * @param count - About how many objects will be added: sizes the grid.
   */
  constructor(extent: WorldBounds | undefined, count: number) {
    const side = extent === undefined ? 1 : Math.ceil(Math.sqrt(Math.max(1, count)));
    this.columns = Math.min(MAX_CELLS_PER_AXIS, side);
    this.rows = this.columns;
    this.minX = extent?.minX ?? 0;
    this.minY = extent?.minY ?? 0;
    const width = extent === undefined ? 0 : extent.maxX - extent.minX;
    const height = extent === undefined ? 0 : extent.maxY - extent.minY;
    // A zero-sized extent (one point) still has cells: 1 world unit each.
    this.cellWidth = width > 0 ? width / this.columns : 1;
    this.cellHeight = height > 0 ? height / this.rows : 1;
  }

  /** Forgets every object: the next segment starts empty. */
  clear(): void {
    for (const entries of this.usedLists) entries.length = 0;
    this.usedLists.length = 0;
    this.pending.length = 0;
    this.wide.length = 0;
    this.unboundedHighest = -1;
  }

  /**
   * Adds an object of the segment.
   *
   * @param bounds - Its world box; `undefined` for an object drawn without one, which then
   *   counts as overlapping everything.
   * @param highestPass - The highest pass index it draws in.
   */
  add(bounds: WorldBounds | undefined, highestPass: number): void {
    // Nothing draws below pass 0, so an object only in pass 0 can never be over an occluder.
    if (highestPass <= 0) return;
    if (bounds === undefined) {
      this.unboundedHighest = Math.max(this.unboundedHighest, highestPass);
      return;
    }
    this.pending.push({ bounds, highestPass });
  }

  /**
   * Whether an object would cover something the segment draws in a later pass: any object added
   * since the last `clear` whose highest pass is above `pass` and whose box meets this one (edges
   * included, so it errs towards a split).
   *
   * @param bounds - The object's world box; `undefined` counts as meeting everything.
   * @param pass - The lowest pass the object draws in.
   * @returns Whether drawing the object in the segment would put later-pass content over it.
   */
  hasLaterOverlap(bounds: WorldBounds | undefined, pass: number): boolean {
    if (this.unboundedHighest > pass) return true;
    this.bucketPending();
    if (bounds === undefined) return this.hasAnyAbove(pass);
    const meets = (entry: GridEntry): boolean =>
      entry.highestPass > pass && intersectsBounds(entry.bounds, bounds);
    if (this.wide.some(meets)) return true;
    const [left, top, right, bottom] = this.cellSpan(bounds);
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        if (this.cells.get(row * this.columns + column)?.some(meets) === true) return true;
      }
    }
    return false;
  }

  /** Buckets the entries added since the last query into the cells their boxes cover. */
  private bucketPending(): void {
    for (const entry of this.pending) {
      const [left, top, right, bottom] = this.cellSpan(entry.bounds);
      if ((right - left + 1) * (bottom - top + 1) > MAX_CELLS_PER_BOX) {
        this.wide.push(entry);
        continue;
      }
      for (let row = top; row <= bottom; row += 1) {
        for (let column = left; column <= right; column += 1) {
          const cell = row * this.columns + column;
          let entries = this.cells.get(cell);
          if (entries === undefined) {
            entries = [];
            this.cells.set(cell, entries);
          }
          if (entries.length === 0) this.usedLists.push(entries);
          entries.push(entry);
        }
      }
    }
    this.pending.length = 0;
  }

  /**
   * Whether anything added draws in a pass above `pass`.
   *
   * @param pass - The pass.
   * @returns Whether any entry's highest pass is above it.
   */
  private hasAnyAbove(pass: number): boolean {
    const isAbove = (entry: GridEntry): boolean => entry.highestPass > pass;
    return this.wide.some(isAbove) || this.usedLists.some((entries) => entries.some(isAbove));
  }

  /**
   * The cells a box covers, clamped to the grid.
   *
   * @param bounds - The box, world units.
   * @returns Its first and last column and row, inclusive.
   */
  private cellSpan(bounds: WorldBounds): [number, number, number, number] {
    const column = (x: number): number =>
      Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.minX) / this.cellWidth)));
    const row = (y: number): number =>
      Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cellHeight)));
    return [column(bounds.minX), row(bounds.minY), column(bounds.maxX), row(bounds.maxY)];
  }
}
