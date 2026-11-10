import type { EnginePixels } from '../host/engine-pixels.js';

import type { CapturePlan, CaptureTile } from './capture-plan.js';

/**
 * Draws one tile of an export and reads it back.
 *
 * @param tile - The tile, with the camera that draws it.
 * @returns Its pixels: RGBA8, rows top to bottom, `widthPx × heightPx × 4` bytes.
 */
export type RenderCaptureTile = (tile: CaptureTile) => Promise<Uint8Array>;

/**
 * Draws an export tile by tile, one at a time in the plan's order, and puts each tile's pixels in
 * place in one image. Drawing stops at the first tile that fails. Pure orchestration:
 * the caller draws (the app on its GPU, a golden scene on the harness's).
 *
 * @param plan - The export's plan (`planCapture`).
 * @param renderTile - Draws one tile.
 * @returns The whole image.
 * @throws {RangeError} When a tile comes back with the wrong number of bytes.
 */
export async function captureScene(
  plan: CapturePlan,
  renderTile: RenderCaptureTile,
): Promise<EnginePixels> {
  const { widthPx, heightPx } = plan;
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (const [index, tile] of plan.tiles.entries()) {
    const pixels = await renderTile(tile);
    const rowBytes = tile.widthPx * 4;
    if (pixels.length !== rowBytes * tile.heightPx) {
      throw new RangeError(
        `Tile ${String(index)} (${String(tile.widthPx)} × ${String(tile.heightPx)} px) came back ` +
          `with ${String(pixels.length)} bytes, not ${String(rowBytes * tile.heightPx)}.`,
      );
    }
    for (let row = 0; row < tile.heightPx; row += 1) {
      const from = row * rowBytes;
      rgba.set(pixels.subarray(from, from + rowBytes), ((tile.yPx + row) * widthPx + tile.xPx) * 4);
    }
  }
  return { widthPx, heightPx, rgba };
}
