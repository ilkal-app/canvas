import type { Crop, Rect } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { WorldTransform } from '../scene/world-transform.js';

import type { ImageAssetTiles } from './asset-source.js';
import { pickLevel, type Size } from './level-selection.js';

/** A rectangle in the unit square of a source image: fractions of its width and height. */
export interface UnitRect {
  /** Left edge, a fraction of the width. */
  readonly minU: number;
  /** Top edge, a fraction of the height. */
  readonly minV: number;
  /** Right edge, a fraction of the width. */
  readonly maxU: number;
  /** Bottom edge, a fraction of the height. */
  readonly maxV: number;
}

/** One tile of an image's tile pyramid (`ImageAssetTiles`). */
export interface TileAddress {
  /** The tile level, 0 the coarsest. */
  readonly level: number;
  /** The column, from 0 at the left. */
  readonly column: number;
  /** The row, from 0 at the top. */
  readonly row: number;
  /** The tile's width, px: the tile size, or less in the last column. */
  readonly widthPx: number;
  /** The tile's height, px: the tile size, or less in the last row. */
  readonly heightPx: number;
  /** Where the tile lies in the source image's unit square. */
  readonly rect: UnitRect;
}

/**
 * The size of one tile level: the original scaled by `2^(level − levels + 1)`, rounded up, so
 * the top level is the original (`ImageAssetTiles`). Pure.
 *
 * @param naturalSize - The original's size, px.
 * @param tiles - The tile pyramid.
 * @param level - The tile level, 0 to `tiles.levels − 1`.
 * @returns The level's size, px.
 */
export function tileLevelSize(naturalSize: Size, tiles: ImageAssetTiles, level: number): Size {
  const scale = 2 ** (level - tiles.levels + 1);
  return {
    width: Math.ceil(naturalSize.width * scale),
    height: Math.ceil(naturalSize.height * scale),
  };
}

/**
 * The coarsest tile level whose long edge meets a requirement, or the top level (the original)
 * when none does, with the image levels' hysteresis (`pickLevel`): from the tile level shown
 * until now, the manager moves up only once it would be stretched more than `LEVEL_UP_SLACK`
 * and down only once a coarser level has room to spare, so a zoom that wobbles across a tile
 * level's edge does not swap every visible tile. Pure.
 *
 * @param requiredPx - The long edge needed, px (`requiredLongEdgePx`).
 * @param naturalSize - The original's size, px.
 * @param tiles - The tile pyramid.
 * @param previous - The tile level shown until now, if any.
 * @returns The tile level.
 */
export function pickTileLevel(
  requiredPx: number,
  naturalSize: Size,
  tiles: ImageAssetTiles,
  previous?: number,
): number {
  const edges: number[] = [];
  for (let level = 0; level < tiles.levels; level += 1) {
    const size = tileLevelSize(naturalSize, tiles, level);
    edges.push(Math.max(size.width, size.height));
  }
  const shown = previous === undefined ? undefined : edges[previous];
  return edges.indexOf(pickLevel(requiredPx, edges, shown));
}

/**
 * The tiles of one level that a region of the image touches, row by row (large images are tiled
 * and only visible tiles are resident, like a map). Pure.
 *
 * @param region - The region, in the image's unit square.
 * @param naturalSize - The original's size, px.
 * @param tiles - The tile pyramid.
 * @param level - The tile level.
 * @returns The tiles, top row first, left to right; none for an empty region.
 */
export function tilesCovering(
  region: UnitRect,
  naturalSize: Size,
  tiles: ImageAssetTiles,
  level: number,
): TileAddress[] {
  if (!(region.maxU > region.minU && region.maxV > region.minV)) return [];
  const size = tileLevelSize(naturalSize, tiles, level);
  const edge = tiles.tileSizePx;
  const columns = Math.ceil(size.width / edge);
  const rows = Math.ceil(size.height / edge);
  const firstColumn = Math.max(0, Math.floor((region.minU * size.width) / edge));
  const lastColumn = Math.min(columns - 1, Math.ceil((region.maxU * size.width) / edge) - 1);
  const firstRow = Math.max(0, Math.floor((region.minV * size.height) / edge));
  const lastRow = Math.min(rows - 1, Math.ceil((region.maxV * size.height) / edge) - 1);
  const found: TileAddress[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const left = column * edge;
      const top = row * edge;
      const widthPx = Math.min(edge, size.width - left);
      const heightPx = Math.min(edge, size.height - top);
      found.push({
        level,
        column,
        row,
        widthPx,
        heightPx,
        rect: {
          minU: left / size.width,
          minV: top / size.height,
          maxU: (left + widthPx) / size.width,
          maxV: (top + heightPx) / size.height,
        },
      });
    }
  }
  return found;
}

/**
 * The part of the source image an image object shows inside the viewport: the viewport's
 * bounding box in the object's own frame, clipped to where the crop is drawn, mapped through the
 * crop into the image's unit square. A rotated box gets the bounds of the viewport's corners in
 * its frame, which may include a little more than is on screen. Pure.
 *
 * @param drawn - Where the crop is drawn in the object's own frame (`fittedImageRect`: the box,
 *   or a rectangle fitted inside it), world units.
 * @param transform - The object's frame to the world.
 * @param crop - The part of the image the box shows.
 * @param viewport - The visible world rectangle.
 * @returns The visible region of the source image, or null when none of the box is visible.
 */
export function visibleImageRect(
  drawn: Rect,
  transform: WorldTransform,
  crop: Crop,
  viewport: WorldBounds,
): UnitRect | null {
  const corners: readonly (readonly [number, number])[] = [
    [viewport.minX, viewport.minY],
    [viewport.maxX, viewport.minY],
    [viewport.maxX, viewport.maxY],
    [viewport.minX, viewport.maxY],
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [worldX, worldY] of corners) {
    // The inverse of the object's rotation about its origin.
    const dx = worldX - transform.x;
    const dy = worldY - transform.y;
    const localX = transform.cos * dx + transform.sin * dy;
    const localY = -transform.sin * dx + transform.cos * dy;
    minX = Math.min(minX, localX);
    minY = Math.min(minY, localY);
    maxX = Math.max(maxX, localX);
    maxY = Math.max(maxY, localY);
  }
  const left = (Math.max(drawn.x, minX) - drawn.x) / drawn.width;
  const top = (Math.max(drawn.y, minY) - drawn.y) / drawn.height;
  const right = (Math.min(drawn.x + drawn.width, maxX) - drawn.x) / drawn.width;
  const bottom = (Math.min(drawn.y + drawn.height, maxY) - drawn.y) / drawn.height;
  if (!(right > left && bottom > top)) return null;
  return {
    minU: crop.x + left * crop.width,
    minV: crop.y + top * crop.height,
    maxU: crop.x + right * crop.width,
    maxV: crop.y + bottom * crop.height,
  };
}
