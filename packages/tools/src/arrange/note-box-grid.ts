/** An axis-aligned box in a parent's frame, world units. */
export interface ParentBox {
  /** The left edge. */
  readonly minX: number;
  /** The top edge. */
  readonly minY: number;
  /** The right edge. */
  readonly maxX: number;
  /** The bottom edge. */
  readonly maxY: number;
}

/** The fields of a boxed object that place it in its parent's frame. */
export interface TurnedBox {
  /** Its left edge before the turn, in the parent's frame. */
  readonly x: number;
  /** Its top edge before the turn. */
  readonly y: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
  /** Its turn, radians clockwise. */
  readonly rotation: number;
}

/**
 * The axis-aligned box round an object's turned box, in its parent's frame: its corners turned
 * about its top-left corner by its rotation (the schema's frame convention). Pure.
 *
 * @param object - A boxed object.
 * @returns The box.
 */
export function parentBoxOf(object: TurnedBox): ParentBox {
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  // The corners' offsets from (x, y): the width edge (ax, ay), the height edge (bx, by), both.
  const [ax, ay] = [cos * object.width, sin * object.width];
  const [bx, by] = [-sin * object.height, cos * object.height];
  return {
    minX: object.x + Math.min(0, ax, bx, ax + bx),
    minY: object.y + Math.min(0, ay, by, ay + by),
    maxX: object.x + Math.max(0, ax, bx, ax + bx),
    maxY: object.y + Math.max(0, ay, by, ay + by),
  };
}

/**
 * Whether two boxes share some area (touching edges do not count). Pure.
 *
 * @param first - One box.
 * @param second - The other.
 * @returns Whether they overlap.
 */
export function isOverlapping(first: ParentBox, second: ParentBox): boolean {
  return (
    first.minX < second.maxX &&
    second.minX < first.maxX &&
    first.minY < second.maxY &&
    second.minY < first.maxY
  );
}

/** The most grid cells along either axis. */
const MAX_CELLS_PER_AXIS = 128;

/**
 * Items (the selected sticky notes of one parent, for `carriedLabelsOf`) bucketed by their boxes
 * on a uniform grid over their extent, about √n cells a side, so asking which items a box
 * overlaps reads only the cells it covers: O(cells covered + candidates) a query instead of
 * O(items). Built once, in O(items × cells each covers). Immutable after construction.
 */
export class NoteBoxGrid<Item> {
  private readonly columns: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly cells = new Map<number, { readonly box: ParentBox; readonly item: Item }[]>();

  /**
   * Buckets the items.
   *
   * @param entries - Each item with its box in the parent's frame; at least one.
   */
  constructor(entries: readonly { readonly box: ParentBox; readonly item: Item }[]) {
    this.columns = Math.min(MAX_CELLS_PER_AXIS, Math.ceil(Math.sqrt(entries.length)));
    const extent = entries.reduce(
      (union, { box }) => ({
        minX: Math.min(union.minX, box.minX),
        minY: Math.min(union.minY, box.minY),
        maxX: Math.max(union.maxX, box.maxX),
        maxY: Math.max(union.maxY, box.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    this.minX = extent.minX;
    this.minY = extent.minY;
    // A flat extent (one point, one line) still has cells: 1 world unit each.
    this.cellWidth = Math.max(extent.maxX - extent.minX, 1) / this.columns;
    this.cellHeight = Math.max(extent.maxY - extent.minY, 1) / this.columns;
    for (const entry of entries) {
      this.forEachCell(entry.box, (cell) => {
        const list = this.cells.get(cell);
        if (list === undefined) this.cells.set(cell, [entry]);
        else list.push(entry);
      });
    }
  }

  /**
   * Whether an item whose box overlaps a box (touching edges do not count) passes a test.
   *
   * @param box - The box, in the parent's frame.
   * @param isWanted - The test, asked only of overlapping items.
   * @returns Whether any overlapping item passes it.
   */
  some(box: ParentBox, isWanted: (item: Item) => boolean): boolean {
    let isFound = false;
    this.forEachCell(box, (cell) => {
      isFound ||=
        this.cells
          .get(cell)
          ?.some((entry) => isOverlapping(entry.box, box) && isWanted(entry.item)) === true;
    });
    return isFound;
  }

  /**
   * Calls a function with every cell a box covers, clamped to the grid.
   *
   * @param box - The box.
   * @param visit - Receives each cell's index.
   */
  private forEachCell(box: ParentBox, visit: (cell: number) => void): void {
    const last = this.columns - 1;
    const column = (x: number): number =>
      Math.min(last, Math.max(0, Math.floor((x - this.minX) / this.cellWidth)));
    const row = (y: number): number =>
      Math.min(last, Math.max(0, Math.floor((y - this.minY) / this.cellHeight)));
    for (let cellRow = row(box.minY); cellRow <= row(box.maxY); cellRow += 1) {
      for (let cellColumn = column(box.minX); cellColumn <= column(box.maxX); cellColumn += 1) {
        visit(cellRow * this.columns + cellColumn);
      }
    }
  }
}
