import { PIN_SIZE_PX } from './comment-card-position.js';

/** A pin's point on screen, CSS px. */
export interface ScreenPin {
  /** Its thread. */
  readonly id: string;
  /** Across. */
  readonly x: number;
  /** Down. */
  readonly y: number;
}

/** Pins drawn as one: a lone pin, or a cluster of pins that overlap on screen. */
export interface PinGroup {
  /** Its threads, in the order the pins were given. */
  readonly ids: readonly string[];
  /** Where it is drawn: its first pin's point, CSS px. */
  readonly x: number;
  /** Down. */
  readonly y: number;
}

/** A rectangle in world units. */
export interface PointBounds {
  /** Left. */
  readonly minX: number;
  /** Top. */
  readonly minY: number;
  /** Right. */
  readonly maxX: number;
  /** Bottom. */
  readonly maxY: number;
}

/**
 * Cells per row of the grid's numeric keys; pins further apart than that share a cell, which
 * costs only a comparison.
 */
const CELL_SPAN = 1 << 20;

/**
 * A grid cell's key: a number, which a map hashes far faster than a string.
 *
 * @param column - The cell's column.
 * @param row - Its row.
 * @returns The key.
 */
function cellKey(column: number, row: number): number {
  const wrap = (value: number): number => ((value % CELL_SPAN) + CELL_SPAN) % CELL_SPAN;
  return wrap(column) * CELL_SPAN + wrap(row);
}

/**
 * The root of a pin's group in a union-find forest, halving the path as it goes.
 *
 * @param parents - Each pin's parent, by index; changed in place.
 * @param index - The pin.
 * @returns Its root.
 */
function rootOf(parents: number[], index: number): number {
  let at = index;
  while (parents[at] !== at) {
    const parent = parents[at] ?? at;
    const grandparent = parents[parent] ?? parent;
    parents[at] = grandparent;
    at = grandparent;
  }
  return at;
}

/**
 * Groups comment pins that overlap on screen (Figma `Comment/Cluster`): two pins
 * overlap when their boxes (`distancePx` squares, the pin's size) do, and a group is every pin
 * reachable through overlaps, so a chain of pins each overlapping the next is one group.
 * Screen-space, so zooming out merges and zooming in splits; each group is drawn at its first
 * pin. Pins are found through a grid of `distancePx` cells: pins in one cell always overlap, so a
 * pin is joined once per cell around it, which keeps a crowded cell cheap. Pure.
 *
 * @param pins - The pins shown, in a stable order.
 * @param distancePx - How close two pins' points are to overlap, CSS px.
 * @returns The groups, in the order their first pins were given.
 */
export function clusterPins(
  pins: readonly ScreenPin[],
  distancePx: number = PIN_SIZE_PX,
): PinGroup[] {
  const parents = [...pins.keys()];
  const cells = new Map<number, number[]>();
  const cellOf = (value: number): number => Math.floor(value / distancePx);
  for (const [index, pin] of pins.entries()) {
    const column = cellOf(pin.x);
    const row = cellOf(pin.y);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of cells.get(cellKey(column + dx, row + dy)) ?? []) {
          const near = pins[other];
          if (!near || Math.abs(near.x - pin.x) >= distancePx) continue;
          if (Math.abs(near.y - pin.y) >= distancePx) continue;
          parents[rootOf(parents, index)] = rootOf(parents, other);
          break; // The rest of that cell is joined to this one already.
        }
      }
    }
    const key = cellKey(column, row);
    const cell = cells.get(key);
    if (cell) cell.push(index);
    else cells.set(key, [index]);
  }
  const groups = new Map<number, { ids: string[]; x: number; y: number }>();
  for (const [index, pin] of pins.entries()) {
    const root = rootOf(parents, index);
    const group = groups.get(root);
    if (group) group.ids.push(pin.id);
    else groups.set(root, { ids: [pin.id], x: pin.x, y: pin.y });
  }
  return [...groups.values()];
}

/**
 * The rectangle around some points.
 *
 * @param points - At least one point.
 * @returns Their bounds.
 */
export function worldBoundsOf(
  points: readonly { readonly x: number; readonly y: number }[],
): PointBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
