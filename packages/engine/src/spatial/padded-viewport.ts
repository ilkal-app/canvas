import type { WorldBounds } from '../camera/camera.js';

import { containsBounds } from './bounds.js';

/**
 * How much larger than a freshly padded viewport a query may be before it is redone: zooming in
 * past this factor re-queries, so the drawn set shrinks with the view instead of drawing a
 * region many times the screen.
 */
const MAX_QUERY_OVERSIZE = 2;

/**
 * The region a culling query covers: the viewport grown on each side by a fraction of its own
 * width (left and right) and height (top and bottom). Small pans stay inside it, so they reuse
 * the last query.
 *
 * @param viewport - The visible world rectangle.
 * @param fraction - The padding per side as a fraction of the viewport's size, at least 0.
 * @returns The padded rectangle, world units.
 */
export function padViewport(viewport: WorldBounds, fraction: number): WorldBounds {
  const padX = (viewport.maxX - viewport.minX) * fraction;
  const padY = (viewport.maxY - viewport.minY) * fraction;
  return {
    minX: viewport.minX - padX,
    minY: viewport.minY - padY,
    maxX: viewport.maxX + padX,
    maxY: viewport.maxY + padY,
  };
}

/**
 * Whether the last culling query still serves a viewport: the viewport lies inside it, and it is
 * at most twice the size of the viewport's own padded region on each axis.
 *
 * @param query - The last query's region.
 * @param viewport - This frame's visible world rectangle.
 * @param fraction - The padding fraction the queries use.
 * @returns True when the last query's result can be reused.
 */
export function isQueryReusable(
  query: WorldBounds,
  viewport: WorldBounds,
  fraction: number,
): boolean {
  if (!containsBounds(query, viewport)) return false;
  const scale = MAX_QUERY_OVERSIZE * (1 + 2 * fraction);
  return (
    query.maxX - query.minX <= scale * (viewport.maxX - viewport.minX) &&
    query.maxY - query.minY <= scale * (viewport.maxY - viewport.minY)
  );
}
