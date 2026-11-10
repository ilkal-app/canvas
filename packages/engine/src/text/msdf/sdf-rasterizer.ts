import type { GlyphOutline } from '@canvas/text';

import { DISTANCE_RANGE_PX, GLYPH_PADDING_PX, type GlyphBitmap } from '../atlas/glyph-bitmap.js';

import { flattenOutline, type Edge } from './outline-flattening.js';

/** Beyond half the range a texel saturates, so nearer edges are all that matter. */
const SATURATION_PX = DISTANCE_RANGE_PX / 2;

/**
 * The raster fallback: a single-channel signed distance field computed from the glyph's own
 * outline, used when msdfgen (WebAssembly in a job worker) is unavailable or failed. It replaces
 * the prototype's Canvas2D + tiny-sdf fallback (`src/atlas/tinySdfProvider.ts`), which the
 * engine cannot use (no DOM), with the true Euclidean distance: exact along edges, but corners
 * round off when magnified, which only MSDF avoids. The encoding and padding are the MSDF
 * path's (`0.5 + d / 16`, 8 px), so one shader draws both.
 *
 * @param outline - The glyph's outline, in em units, y up.
 * @param advanceEm - The glyph's advance, in em.
 * @param tier - Raster px per em.
 * @returns The field as an `sdf` bitmap; empty (0 × 0) when the outline has no contours.
 */
export function rasterizeSdfGlyph(
  outline: GlyphOutline,
  advanceEm: number,
  tier: number,
): GlyphBitmap {
  const edges = flattenOutline(outline, tier);
  const advance = advanceEm * tier;
  if (edges.length === 0) {
    return {
      field: 'sdf',
      width: 0,
      height: 0,
      pixels: new Uint8Array(0),
      left: 0,
      top: 0,
      advance,
    };
  }
  const xs = edges.flatMap(({ x0, x1 }) => [x0, x1]);
  const ys = edges.flatMap(({ y0, y1 }) => [y0, y1]);
  const left = Math.floor(Math.min(...xs)) - GLYPH_PADDING_PX;
  const top = Math.ceil(Math.max(...ys)) + GLYPH_PADDING_PX;
  const width = Math.ceil(Math.max(...xs)) + GLYPH_PADDING_PX - left;
  const height = top - (Math.floor(Math.min(...ys)) - GLYPH_PADDING_PX);
  const pixels = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const y = top - row - 0.5;
    const crossings = rowCrossings(edges, y);
    for (let column = 0; column < width; column += 1) {
      const x = left + column + 0.5;
      const distance = nearestEdgeDistance(edges, x, y);
      const isInside = windingAt(crossings, x) !== 0;
      const encoded = 0.5 + (isInside ? distance : -distance) / DISTANCE_RANGE_PX;
      pixels[row * width + column] = Math.round(Math.min(1, Math.max(0, encoded)) * 255);
    }
  }
  return { field: 'sdf', width, height, pixels, left, top, advance };
}

/**
 * Where the edges cross the horizontal line at `y`, with their direction: +1 going up, −1
 * going down. A crossing counts when `y` is in `[min(y0, y1), max(y0, y1))`, so a vertex shared
 * by two edges is counted once.
 *
 * @param edges - The glyph's edges.
 * @param y - The row's y, in raster px.
 * @returns The crossings, sorted by x.
 */
function rowCrossings(edges: readonly Edge[], y: number): { x: number; direction: number }[] {
  const crossings: { x: number; direction: number }[] = [];
  for (const { x0, y0, x1, y1 } of edges) {
    const isCrossing = (y0 <= y && y < y1) || (y1 <= y && y < y0);
    if (!isCrossing) continue;
    crossings.push({ x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), direction: y1 > y0 ? 1 : -1 });
  }
  return crossings.sort((a, b) => a.x - b.x);
}

/**
 * The winding number at a point: the signed crossings to its left.
 *
 * @param crossings - The row's crossings, sorted by x.
 * @param x - The point's x.
 * @returns The winding number; non-zero is inside.
 */
function windingAt(crossings: readonly { x: number; direction: number }[], x: number): number {
  let winding = 0;
  for (const crossing of crossings) {
    if (crossing.x >= x) break;
    winding += crossing.direction;
  }
  return winding;
}

/**
 * The distance from a point to the nearest edge, saturating at {@link SATURATION_PX}: edges
 * whose bounding box is farther than the best distance so far are skipped.
 *
 * @param edges - The glyph's edges.
 * @param x - The point's x, in raster px.
 * @param y - The point's y, in raster px.
 * @returns The distance, in raster px, at most the saturation distance.
 */
function nearestEdgeDistance(edges: readonly Edge[], x: number, y: number): number {
  let best = SATURATION_PX;
  for (const { x0, y0, x1, y1 } of edges) {
    const isFar =
      x < Math.min(x0, x1) - best ||
      x > Math.max(x0, x1) + best ||
      y < Math.min(y0, y1) - best ||
      y > Math.max(y0, y1) + best;
    if (isFar) continue;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}
