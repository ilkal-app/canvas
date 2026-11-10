import type { WorldBounds } from '../camera/camera.js';

/**
 * How far ahead the texture manager looks along the pan, ms: long enough for a level to be
 * fetched, decoded and uploaded before the image it belongs to comes on screen.
 */
export const PREFETCH_LOOKAHEAD_MS = 400;

/** The furthest the prefetch region moves, in viewport widths and heights: a fling looks this far. */
export const MAX_PREFETCH_VIEWPORTS = 2;

/** A velocity in world units per millisecond. */
export interface WorldVelocity {
  /** Along x, world units per ms. */
  readonly x: number;
  /** Along y, world units per ms. */
  readonly y: number;
}

/**
 * How fast the viewport's centre moves: its displacement between two frames over the time
 * between them. Zooming about the centre is no motion. Pure.
 *
 * @param previous - The earlier frame's viewport, world units.
 * @param current - This frame's viewport, world units.
 * @param elapsedMs - The time between the two frames, ms.
 * @returns The velocity; zero when no time passed.
 */
export function viewportVelocity(
  previous: WorldBounds,
  current: WorldBounds,
  elapsedMs: number,
): WorldVelocity {
  if (!(elapsedMs > 0)) return { x: 0, y: 0 };
  const dx = (current.minX + current.maxX - previous.minX - previous.maxX) / 2;
  const dy = (current.minY + current.maxY - previous.minY - previous.maxY) / 2;
  return { x: dx / elapsedMs, y: dy / elapsedMs };
}

/**
 * The region the viewport is heading for (levels are prefetched for objects the viewport is moving
 * towards, using the pan velocity): the viewport moved by velocity × lookahead, at most
 * {@link MAX_PREFETCH_VIEWPORTS} of its own size on each axis. Pure.
 *
 * @param viewport - The visible world rectangle.
 * @param velocity - The pan velocity, world units per ms.
 * @param lookaheadMs - How far ahead to look, ms.
 * @returns The moved rectangle, world units.
 */
export function prefetchViewport(
  viewport: WorldBounds,
  velocity: WorldVelocity,
  lookaheadMs: number,
): WorldBounds {
  const width = viewport.maxX - viewport.minX;
  const height = viewport.maxY - viewport.minY;
  const dx = clampMagnitude(velocity.x * lookaheadMs, width * MAX_PREFETCH_VIEWPORTS);
  const dy = clampMagnitude(velocity.y * lookaheadMs, height * MAX_PREFETCH_VIEWPORTS);
  return {
    minX: viewport.minX + dx,
    minY: viewport.minY + dy,
    maxX: viewport.maxX + dx,
    maxY: viewport.maxY + dy,
  };
}

function clampMagnitude(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * The shortest prefetch reach, a share of the rectangle's size on its axis: a pan whose
 * lookahead falls short of it prefetches nothing along that axis (the padded viewport already
 * loads that far ahead), and every longer reach is this times a power of two.
 */
export const MIN_PREFETCH_REACH_SHARE = 1 / 16;

/** How far the lookahead must fall below the reach before the reach shrinks: a quarter. */
const REACH_SHRINK_RATIO = 4;

/**
 * How far along one axis the prefetch region moves ahead of the view, with hysteresis, so that
 * a drag whose speed varies keeps the same prefetch region, and with it the same prefetch
 * images (the texture manager's pan then plans nothing, keeping camera-only frames
 * cheap). The lookahead (velocity × {@link PREFETCH_LOOKAHEAD_MS}) is rounded up to a step of
 * {@link MIN_PREFETCH_REACH_SHARE} of `extent` times a power of two, at most
 * {@link MAX_PREFETCH_VIEWPORTS} × `extent`; the previous reach is kept while the lookahead
 * points the same way and is between a quarter of it and it, so the region never reaches less
 * far than the lookahead and moves only when the speed at least doubles or falls to a quarter.
 * Pure.
 *
 * @param lookahead - How far the view moves along the axis in the lookahead, world units
 *   (signed).
 * @param previous - The reach of the last frame, world units (signed); 0 for none.
 * @param extent - The size along the axis of the rectangle that moves, world units.
 * @returns The reach, world units (signed); 0 when the lookahead is shorter than the shortest.
 */
export function prefetchReach(lookahead: number, previous: number, extent: number): number {
  const limit = extent * MAX_PREFETCH_VIEWPORTS;
  const size = Math.min(Math.abs(lookahead), limit);
  const kept = Math.abs(previous);
  const isSameWay = Math.sign(lookahead) === Math.sign(previous);
  if (isSameWay && kept <= limit && size <= kept && size * REACH_SHRINK_RATIO >= kept) {
    return previous;
  }
  let step = extent * MIN_PREFETCH_REACH_SHARE;
  if (!(step > 0) || size < step) return 0;
  while (step < size) step *= 2;
  return Math.sign(lookahead) * Math.min(step, limit);
}

/**
 * The part of the prefetch region outside the padded search (`prefetchViewport` of the padded
 * rectangle, minus the rectangle): at most two strips, one beside it along x and one above or
 * below it along y, the second clipped to the first's gap so no point lies in both. Images in
 * the strips and not in the padded rectangle are the prefetch candidates, found without
 * searching the padded rectangle again. Pure.
 *
 * @param padded - The padded search rectangle, world units.
 * @param ahead - The same rectangle moved along the pan, world units.
 * @returns The strips, world units; none when the rectangle did not move.
 */
export function prefetchStrips(padded: WorldBounds, ahead: WorldBounds): WorldBounds[] {
  const strips: WorldBounds[] = [];
  if (ahead.maxX > padded.maxX) {
    strips.push({ ...ahead, minX: Math.max(padded.maxX, ahead.minX) });
  } else if (ahead.minX < padded.minX) {
    strips.push({ ...ahead, maxX: Math.min(padded.minX, ahead.maxX) });
  }
  const minX = Math.max(padded.minX, ahead.minX);
  const maxX = Math.min(padded.maxX, ahead.maxX);
  if (maxX <= minX) return strips;
  if (ahead.maxY > padded.maxY) {
    strips.push({ minX, maxX, minY: Math.max(padded.maxY, ahead.minY), maxY: ahead.maxY });
  } else if (ahead.minY < padded.minY) {
    strips.push({ minX, maxX, minY: ahead.minY, maxY: Math.min(padded.minY, ahead.maxY) });
  }
  return strips;
}
