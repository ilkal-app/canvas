import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';

/** What the per-frame limit orders a layer by. */
export interface LimitRanked {
  /** The layer. */
  readonly id: ObjectId;
  /** How many layers enclose it: the outermost go first. */
  readonly depth: number;
  /** Its content's area, device pixels: the larger go next. */
  readonly area: number;
}

/**
 * How much larger a newcomer's area must be than an incumbent's of the same depth to take its
 * slot when every slot is held: a quarter.
 */
export const LAYER_LIMIT_MARGIN = 1.25;

/**
 * Orders candidates for the limit: outermost first, then the larger area, then the lower id.
 *
 * @param a - One candidate.
 * @param b - Another.
 * @returns Negative when `a` goes first.
 */
export function byPriority(a: LimitRanked, b: LimitRanked): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.area !== b.area) return b.area - a.area;
  return a.id < b.id ? -1 : 1; // Ids are unique: never equal.
}

/**
 * Whether a newcomer clearly outranks an incumbent: it is outer, or as deep and at least
 * {@link LAYER_LIMIT_MARGIN} times its area.
 *
 * @param newcomer - The layer that composited nowhere last.
 * @param incumbent - The layer holding a slot.
 * @returns True when the newcomer takes the slot.
 */
function isClearlyAhead(newcomer: LimitRanked, incumbent: LimitRanked): boolean {
  if (newcomer.depth !== incumbent.depth) return newcomer.depth < incumbent.depth;
  return newcomer.area >= LAYER_LIMIT_MARGIN * incumbent.area;
}

/**
 * The order the limit takes candidates in, with hysteresis: the incumbents (those
 * that composited when last on the canvas) keep their slots, by priority, up to the limit; a
 * newcomer takes a free slot, or the weakest incumbent's when it is clearly ahead of it
 * (`isClearlyAhead`); the rest follow by priority. With no incumbent (a cold start) it is the
 * priority order itself. Deterministic: it depends only on the candidates and the incumbents.
 * Pure.
 *
 * @param ranked - The candidates on the canvas, by priority (`byPriority`).
 * @param isIncumbent - Whether a layer composited when last on the canvas.
 * @param limit - How many slots there are.
 * @returns The candidates: those holding slots first, by priority, then the others.
 */
export function limitOrder<T extends LimitRanked>(
  ranked: readonly T[],
  isIncumbent: (id: ObjectId) => boolean,
  limit: number,
): T[] {
  const slotted: T[] = [];
  const others: T[] = [];
  for (const layer of ranked) {
    if (!isIncumbent(layer.id)) continue;
    if (slotted.length < limit) slotted.push(layer);
    else others.push(layer);
  }
  for (const layer of ranked) {
    if (isIncumbent(layer.id)) continue;
    // The weakest held slot, by priority: `slotted` stays sorted.
    const weakest = slotted.at(-1);
    if (slotted.length < limit) slotted.push(layer);
    else if (weakest !== undefined && isClearlyAhead(layer, weakest)) {
      slotted.pop();
      others.push(weakest);
      slotted.push(layer);
    } else {
      others.push(layer);
      continue;
    }
    slotted.sort(byPriority);
  }
  return [...slotted, ...others.sort(byPriority)];
}

/**
 * Whether bounds are within a view's own size of it: a composited layer that left the canvas by
 * less keeps its slot under the limit, so a pan or zoom that wobbles across the canvas's edge
 * swaps no layer.
 *
 * @param bounds - The layer's bounds.
 * @param view - The visible world.
 * @returns True when near enough.
 */
export function isWithinView(bounds: WorldBounds, view: WorldBounds): boolean {
  const reachX = view.maxX - view.minX;
  const reachY = view.maxY - view.minY;
  return (
    bounds.maxX > view.minX - reachX &&
    bounds.minX < view.maxX + reachX &&
    bounds.maxY > view.minY - reachY &&
    bounds.minY < view.maxY + reachY
  );
}
