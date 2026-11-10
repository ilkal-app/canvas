import type { SpatialSearch, WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { worldBoundsOfBox } from '../select/oriented-box.js';
import { orientedBoxOf, type SelectionSource } from '../select/selection-geometry.js';

/**
 * The most candidates one band keeps: the nearest to the box's lines. It bounds the geometry and
 * ranking work of a drag step (select boxes, line comparisons, guides) whatever the board holds;
 * the walk up each hit's parents to leave out what moves runs before the cap, once per object
 * the index returns.
 */
export const SNAP_CANDIDATES_PER_BAND = 64;

/** Where {@link snapCandidatesNear} looks. */
export interface SnapCandidateQuery {
  /**
   * What is on screen, world units: nothing outside it is a candidate, and a box more than half
   * as wide or as tall as it snaps to no object.
   */
  readonly viewport: WorldBounds;
  /** The snap threshold, world units (`snapThresholdAt`). */
  readonly thresholdWorld: number;
  /**
   * Candidates' boxes already worked out, by id (`null` for an object without one), read and
   * filled in: a drag passes the same map for every step of its gesture, so a step computes only
   * the boxes of objects it has not met yet. Nothing is kept if absent.
   */
  readonly boxes?: Map<ObjectId, WorldBounds | null>;
}

/**
 * The index snapping queries: rectangle search, and, when the index keeps them (as
 * `SceneSpatialIndex` does), each object's indexed box, which ranks a band's objects without
 * working out their exact select boxes.
 */
export interface SnapIndex extends SpatialSearch {
  /**
   * An object's indexed world box (grown by stroke reach; close enough to rank by).
   *
   * @param id - The object.
   * @returns Its box, or undefined when it is not indexed.
   */
  boundsOf?(id: ObjectId): WorldBounds | undefined;
}

/** Deeper than any board nests: the parent walk stops here, so a parent cycle cannot hang it. */
const MAX_DEPTH = 256;

type Axis = 'x' | 'y';

/**
 * The intersection of two rectangles.
 *
 * @param first - One rectangle.
 * @param second - The other.
 * @returns Their overlap, or undefined when they do not meet.
 */
function intersect(first: WorldBounds, second: WorldBounds): WorldBounds | undefined {
  const minX = Math.max(first.minX, second.minX);
  const minY = Math.max(first.minY, second.minY);
  const maxX = Math.min(first.maxX, second.maxX);
  const maxY = Math.min(first.maxY, second.maxY);
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : undefined;
}

/**
 * Whether an object moves with the drag: it, or one of its ancestors, is being moved.
 *
 * @param objectId - The object.
 * @param excludedIds - The moving objects.
 * @param source - The document, for parents.
 * @returns True when it moves with the drag.
 */
function isMoving(
  objectId: ObjectId,
  excludedIds: ReadonlySet<ObjectId>,
  source: SelectionSource,
): boolean {
  let current: ObjectId | null = objectId;
  for (let depth = 0; current !== null && depth < MAX_DEPTH; depth += 1) {
    if (excludedIds.has(current)) return true;
    current = source.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * An object's select box as world bounds (`orientedBoxOf`, bounded by its corners when turned),
 * from the cache when it has it.
 *
 * @param objectId - The object.
 * @param source - The document.
 * @param boxes - The gesture's cache, if any.
 * @returns The bounds, or null for an object without geometry.
 */
function exactBoundsOf(
  objectId: ObjectId,
  source: SelectionSource,
  boxes: Map<ObjectId, WorldBounds | null> | undefined,
): WorldBounds | null {
  const cached = boxes?.get(objectId);
  if (cached !== undefined) return cached;
  const oriented = orientedBoxOf(objectId, source);
  const bounds = oriented ? worldBoundsOfBox(oriented) : null;
  boxes?.set(objectId, bounds);
  return bounds;
}

/**
 * How near two boxes' lines come on an axis: the least distance between one of the box's
 * edges or centre and one of the other's.
 *
 * @param box - The dragged box.
 * @param other - A candidate's box.
 * @param axis - The axis.
 * @returns The distance, world units.
 */
function lineDistance(box: WorldBounds, other: WorldBounds, axis: Axis): number {
  // Allocation-free: it runs once per object a band returns.
  const low = axis === 'x' ? box.minX : box.minY;
  const high = axis === 'x' ? box.maxX : box.maxY;
  const otherLow = axis === 'x' ? other.minX : other.minY;
  const otherHigh = axis === 'x' ? other.maxX : other.maxY;
  let least = Number.POSITIVE_INFINITY;
  for (let line = 0; line < 3; line += 1) {
    const value = line === 0 ? low : line === 1 ? (low + high) / 2 : high;
    least = Math.min(
      least,
      Math.abs(value - otherLow),
      Math.abs(value - (otherLow + otherHigh) / 2),
      Math.abs(value - otherHigh),
    );
  }
  return least;
}

/** A band's candidate and how near its lines come to the box's. */
interface Ranked {
  readonly id: ObjectId;
  readonly distance: number;
}

/**
 * Keeps the `limit` nearest of a stream in a max-heap (the farthest kept at the root): O(log
 * limit) per item.
 *
 * @param heap - The heap; changed in place.
 * @param item - The next item.
 * @param limit - How many to keep.
 */
function keepNearest(heap: Ranked[], item: Ranked, limit: number): void {
  // Ranked by distance, then by id: which candidates a crowded band keeps does not
  // depend on the order the index returns them in.
  const isWorse = (first: Ranked | undefined, second: Ranked | undefined): boolean =>
    first !== undefined &&
    (second === undefined ||
      first.distance > second.distance ||
      (first.distance === second.distance && first.id > second.id));
  const swap = (a: number, b: number): void => {
    const first = heap[a];
    const second = heap[b];
    if (first === undefined || second === undefined) return;
    heap[a] = second;
    heap[b] = first;
  };
  if (heap.length < limit) {
    heap.push(item);
    for (let index = heap.length - 1; index > 0;) {
      const parent = (index - 1) >> 1;
      if (!isWorse(heap[index], heap[parent])) break;
      swap(parent, index);
      index = parent;
    }
    return;
  }
  if (!isWorse(heap[0], item)) return;
  heap[0] = item;
  const worstOf = (index: number): number => {
    const left = 2 * index + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
    return worst;
  };
  let index = 0;
  let worst = worstOf(index);
  while (worst !== index) {
    swap(index, worst);
    index = worst;
    worst = worstOf(index);
  }
}

/**
 * The thin bands through a box's lines on one axis: for each of its low edge, centre and high
 * edge, the strip within the reach of that line, across the viewport. An object with a line
 * within reach of one of the box's lines crosses the strip round it (the line lies inside the
 * object), so these strips find exactly the objects that can snap on the axis, whatever the
 * box's size.
 *
 * @param box - The dragged box.
 * @param axis - The axis whose lines the strips run along.
 * @param reach - The snap threshold, world units.
 * @param viewport - What is on screen.
 * @returns The strips, clipped to the viewport; those off screen left out.
 */
function linesBandsOf(
  box: WorldBounds,
  axis: Axis,
  reach: number,
  viewport: WorldBounds,
): WorldBounds[] {
  const low = axis === 'x' ? box.minX : box.minY;
  const high = axis === 'x' ? box.maxX : box.maxY;
  const strips: WorldBounds[] = [];
  for (const line of [low, (low + high) / 2, high]) {
    const strip =
      axis === 'x'
        ? { minX: line - reach, minY: viewport.minY, maxX: line + reach, maxY: viewport.maxY }
        : { minX: viewport.minX, minY: line - reach, maxX: viewport.maxX, maxY: line + reach };
    const clipped = intersect(strip, viewport);
    if (clipped) strips.push(clipped);
  }
  return strips;
}

/**
 * The objects a dragged box may snap to: those on
 * screen with an edge or centre within the threshold of one of the box's edges or centre, on
 * either axis. Six thin R-tree queries find them, a strip within reach of each of the box's
 * lines on each axis, clipped to the viewport (`linesBandsOf`): nothing scans the board, and the
 * strips do not widen with the box, so a large selection costs what a small one does. Objects
 * that move with the drag (the excluded ids and everything inside them) are left out. Each axis
 * then keeps its {@link SNAP_CANDIDATES_PER_BAND} objects whose lines come nearest the box's,
 * ranked by their indexed boxes when the index keeps them, so the geometry and ranking work
 * (select boxes, `orientedBoxOf`: exact geometry without the stroke reach the index pads with;
 * comparisons; guides) is bounded per step. The walk up a hit's parents that leaves out moving
 * objects runs before the cap, once per object the index returns. A box more than half as wide
 * or as tall as the viewport snaps to no object at all, whether it is a select-all drag at fit
 * or a single object that large. The cost of a step is the six queries and a constant plus a
 * parent walk per object they return (those lined up with the box), then O(N log N) for the N
 * kept. Pure: reads the index and the document; fills the cache it is given.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document.
 * @param box - The dragged box, world units.
 * @param excludedIds - The objects being dragged.
 * @param query - The viewport, the threshold and the gesture's box cache.
 * @returns The candidates' boxes, world units, in no particular order.
 */
export function snapCandidatesNear(
  index: SnapIndex,
  source: SelectionSource,
  box: WorldBounds,
  excludedIds: ReadonlySet<ObjectId>,
  query: SnapCandidateQuery,
): WorldBounds[] {
  const { viewport, thresholdWorld: reach, boxes } = query;
  const isLarge =
    box.maxX - box.minX > (viewport.maxX - viewport.minX) / 2 ||
    box.maxY - box.minY > (viewport.maxY - viewport.minY) / 2;
  if (isLarge) return [];
  const kept = new Set<ObjectId>();
  for (const axis of ['x', 'y'] as const) {
    const heap: Ranked[] = [];
    const seen = new Set<ObjectId>();
    for (const rect of linesBandsOf(box, axis, reach, viewport)) {
      for (const id of index.searchRect(rect)) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (isMoving(id, excludedIds, source)) continue;
        const ranking = index.boundsOf?.(id) ?? exactBoundsOf(id, source, boxes);
        if (!ranking) continue;
        const distance = lineDistance(box, ranking, axis);
        keepNearest(heap, { id, distance }, SNAP_CANDIDATES_PER_BAND);
      }
    }
    for (const { id } of heap) kept.add(id);
  }
  const candidates: WorldBounds[] = [];
  for (const id of kept) {
    const bounds = exactBoundsOf(id, source, boxes);
    if (bounds) candidates.push(bounds);
  }
  return candidates;
}
