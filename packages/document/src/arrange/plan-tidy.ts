import { boundsOfBoxes, moveBoxTo, type ArrangeBox, type ArrangeMove } from './arrange-box.js';

/** A box and its place in the input, so the moves come out in the input's order. */
interface ListedBox extends ArrangeBox {
  readonly index: number;
}

/**
 * The largest of some numbers, without spreading them into arguments (a selection can be
 * larger than the engine's argument limit).
 *
 * @param values - The numbers.
 * @returns The largest, or −∞ for none.
 */
function maxOf(values: readonly number[]): number {
  return values.reduce((largest, value) => Math.max(largest, value), Number.NEGATIVE_INFINITY);
}

function centreX(box: ArrangeBox): number {
  return box.x + box.width / 2;
}

function centreY(box: ArrangeBox): number {
  return box.y + box.height / 2;
}

/**
 * The boxes in reading order, as rows: top to bottom by centre, a box starting a new row when it
 * lies wholly below every box of the current one; each row left to right by centre. Equal centres
 * keep the input order.
 *
 * @param boxes - The boxes; at least one.
 * @returns The rows.
 */
function readingRows(boxes: readonly ArrangeBox[]): ListedBox[][] {
  const rows: ListedBox[][] = [];
  let row: ListedBox[] = [];
  let rowBottom = Number.NEGATIVE_INFINITY;
  const listed = boxes.map((box, index) => ({ ...box, index }));
  for (const box of listed.sort((first, second) => centreY(first) - centreY(second))) {
    if (row.length > 0 && box.y >= rowBottom) {
      rows.push(row);
      row = [];
      rowBottom = Number.NEGATIVE_INFINITY;
    }
    row.push(box);
    rowBottom = Math.max(rowBottom, box.y + box.height);
  }
  rows.push(row);
  return rows.map((each) => each.sort((first, second) => centreX(first) - centreX(second)));
}

/**
 * The gaps the boxes leave now: between neighbours in each row, and between each row's lowest
 * bottom and the next row's highest top.
 *
 * @param rows - The rows in reading order.
 * @returns The gaps, world units; negative where boxes overlap.
 */
function gapsOf(rows: readonly (readonly ArrangeBox[])[]): number[] {
  const gaps: number[] = [];
  let previousBottom: number | undefined;
  for (const row of rows) {
    let previous: ArrangeBox | undefined;
    for (const box of row) {
      if (previous) gaps.push(box.x - (previous.x + previous.width));
      previous = box;
    }
    const top = -maxOf(row.map((box) => -box.y));
    if (previousBottom !== undefined) gaps.push(top - previousBottom);
    previousBottom = maxOf(row.map((box) => box.y + box.height));
  }
  return gaps;
}

/**
 * The median of some numbers: the middle one, or the mean of the middle two.
 *
 * @param values - The numbers; at least one.
 * @returns The median.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = sorted.slice(
    Math.floor((sorted.length - 1) / 2),
    Math.floor(sorted.length / 2) + 1,
  );
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
}

/**
 * The start of each cell along one axis: cells of these sizes, `spacing` apart, from `origin`.
 *
 * @param origin - Where the first cell starts.
 * @param sizes - Each cell's size.
 * @param spacing - The space between cells.
 * @returns The starts.
 */
function cellStarts(origin: number, sizes: readonly number[], spacing: number): number[] {
  let cursor = origin;
  return sizes.map((size) => {
    const start = cursor;
    cursor += size + spacing;
    return start;
  });
}

/**
 * Plans a tidy up: the boxes, in reading order of where they are now
 * (rows top to bottom, each left to right), go into a grid of those rows, each box at the
 * top-left of its cell. A column is as wide as its widest box and a row as tall as its tallest;
 * the space between cells is the median of the gaps the boxes leave now (between neighbours in
 * a row and between rows), or 0 when that is negative; the grid starts at the boxes' bounds'
 * top-left corner. Pure; the boxes are not changed.
 *
 * @param boxes - The boxes, axis-aligned in one frame, world units.
 * @returns The moves, in the boxes' order; nothing for fewer than two boxes.
 */
export function planTidy(boxes: readonly ArrangeBox[]): ArrangeMove[] {
  const bounds = boundsOfBoxes(boxes);
  if (bounds === undefined || boxes.length < 2) return [];
  const rows = readingRows(boxes);
  const spacing = Math.max(0, median(gapsOf(rows)));
  const columnCount = maxOf(rows.map((row) => row.length));
  const widths = [...Array(columnCount).keys()].map((column) =>
    maxOf(rows.map((row) => row[column]?.width ?? 0)),
  );
  const xs = cellStarts(bounds.x, widths, spacing);
  const moves: ArrangeMove[][] = [];
  let y = bounds.y;
  for (const row of rows) {
    for (const [column, x] of xs.entries()) {
      const box = row[column];
      if (box) moves[box.index] = moveBoxTo(box, { x, y });
    }
    y += maxOf(row.map((box) => box.height)) + spacing;
  }
  return moves.flat();
}
