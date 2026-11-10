import type { GpuCapabilities } from '../../gpu/gpu-capabilities.js';
import type { GpuViewport } from '../../gpu/gpu-render-pass.js';
import { renderTargetByteLength } from '../../gpu/gpu-render-target.js';
import { LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH } from '../../gpu/layer-composite-pass.js';
import { DESKTOP_BUDGET_BYTES } from '../../memory/device-budget.js';

/**
 * The most layers a frame composites (): past it, the rest draw in
 * the multiply form. About 50–100 µs of CPU and a target pass each, so 16 keep a frame of
 * layers inside its budget.
 */
export const LAYER_LIMIT = 16;

/**
 * A layer whose content is under this many device pixels on its longer edge draws in the
 * multiply form (): a target pass costs more than doubled-up overlaps
 * that small are worth. The band around it is {@link LAYER_SMALL_BAND}.
 */
export const LAYER_SMALL_EDGE_PX = 64;

/**
 * The hysteresis band of {@link LAYER_SMALL_EDGE_PX}, as a fraction: a composited layer falls
 * back only under 64 × (1 − 0.2) = 51.2 px, and a fallen-back one composites again only from
 * 64 / (1 − 0.2) = 80 px, so a slow zoom never alternates the form (the level-of-detail band's
 * 20%, taken on both sides of the threshold). A layer seen for the first time takes its
 * form at the threshold itself.
 */
export const LAYER_SMALL_BAND = 0.2;

/** Layer targets are sized in steps of this many device pixels, so a slow zoom reuses them. */
export const LAYER_TARGET_BUCKET_PX = 64;

/** A pooled layer target no frame used for longer than this many ms is freed. */
export const LAYER_IDLE_RELEASE_MS = 2000;

/**
 * The largest edge of a layer pass, device pixels: a larger layer renders in
 * tiles of at most this size, so the backend's shared multisampled scratch never exceeds it.
 */
export const LAYER_TILE_PX = 1024;

/** The smallest tile {@link layerTileEdge} chooses, however small the budget. */
const MIN_LAYER_TILE_PX = 256;

/**
 * Bytes per texel of the backends' shared scratch at its worst: 4× MSAA `RGBA8` colour and a
 * 4-byte depth-stencil per sample (WebGL2; WebGPU's `stencil8` and single-sample resolve come to
 * 24). The tile edge is chosen at this rate (`layerTileEdge`); the scratch is charged at the
 * backend's own (`layerScratchBytesPerTexel`).
 */
export const LAYER_SCRATCH_BYTES_PER_TEXEL = 32;

/** A width and a height, device pixels. */
export interface LayerExtent {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/**
 * Bytes per texel of a backend's shared target scratch, as it allocates it: on
 * WebGPU, the colour and the `stencil8` per sample plus, when multisampled, a single-sample
 * resolve (24 at 4× MSAA); on WebGL2, an `RGBA8` colour and a `DEPTH24_STENCIL8` renderbuffer per
 * sample (32 at 4× MSAA). Pure.
 *
 * @param capabilities - The backend's name and samples per pixel.
 * @returns The bytes per texel.
 */
export function layerScratchBytesPerTexel(
  capabilities: Pick<GpuCapabilities, 'backendName' | 'sampleCount'>,
): number {
  const samples = Math.max(1, capabilities.sampleCount);
  if (capabilities.backendName === 'webgl2') return samples * 8;
  return samples * 5 + (samples > 1 ? 4 : 0);
}

/** The share of the layers budget the scratch may take: the rest is for resolved targets. */
const SCRATCH_SHARE = 3 / 4;

/**
 * The layers share of the desktop budget (6/64 of 512 MiB, `budgetForDevice`): what a layer
 * composite pass built without a budget draws within.
 */
export const DEFAULT_LAYER_BYTE_BUDGET = (DESKTOP_BUDGET_BYTES * 6) / 64;

/**
 * A target edge for a layer rectangle's edge: rounded up to {@link LAYER_TARGET_BUCKET_PX}, at
 * most `max`. Pure.
 *
 * @param px - The rectangle's edge, device pixels, at least 1.
 * @param max - The largest edge (the tile's).
 * @returns The bucketed edge.
 */
export function bucketEdge(px: number, max: number): number {
  return Math.min(Math.ceil(px / LAYER_TARGET_BUCKET_PX) * LAYER_TARGET_BUCKET_PX, max);
}

/**
 * The tile edge for a layers budget and device: {@link LAYER_TILE_PX} halved
 * while its scratch ({@link layerScratchBytes}) would take more than three quarters of the
 * budget, never under 256 px nor past the device's largest texture. A desktop's 48 MiB keeps
 * 1024 px (32 MiB of scratch); a phone's 12 MiB takes 512 px (8 MiB). Pure.
 *
 * @param byteBudget - The layers share, bytes.
 * @param maxTextureSize - The device's largest texture edge.
 * @returns The tile edge, device pixels.
 */
export function layerTileEdge(byteBudget: number, maxTextureSize: number): number {
  let tile = Math.min(LAYER_TILE_PX, maxTextureSize);
  const scratchOf = (edge: number) => layerScratchBytes({ width: edge, height: edge });
  while (tile > MIN_LAYER_TILE_PX && scratchOf(tile) > byteBudget * SCRATCH_SHARE) {
    tile /= 2;
  }
  return tile;
}

/**
 * The bytes of the shared scratch at an extent: the backends size it to the widest
 * and tallest live target, so it is charged at that extent, not a whole tile. Pure.
 *
 * @param extent - The scratch's extent: the live targets' widest width and tallest height.
 * @param bytesPerTexel - The backend's rate (`layerScratchBytesPerTexel`); default the worst,
 *   {@link LAYER_SCRATCH_BYTES_PER_TEXEL}.
 * @returns The bytes.
 */
export function layerScratchBytes(
  extent: LayerExtent,
  bytesPerTexel = LAYER_SCRATCH_BYTES_PER_TEXEL,
): number {
  return extent.width * extent.height * bytesPerTexel;
}

/**
 * A layer rectangle's tiles: the rectangle itself when it fits a tile, else its
 * cuts along the canvas's grid of `tile` pixels, on each axis the rectangle overruns, left to
 * right, then top to bottom. Each tile renders the layer's window with its own camera and
 * composites alone, edge to edge with its neighbours on whole pixels, so no seam shows. Pure.
 *
 * @param rect - The layer's rectangle, canvas device pixels.
 * @param tile - The tile edge.
 * @returns The tiles, each at most `tile` on both edges.
 */
export function layerTiles(rect: GpuViewport, tile: number): GpuViewport[] {
  if (rect.width <= tile && rect.height <= tile) return [rect];
  const columns = cuts(rect.x, rect.width, tile);
  const rows = cuts(rect.y, rect.height, tile);
  const tiles: GpuViewport[] = [];
  for (const [y, height] of rows) {
    for (const [x, width] of columns) tiles.push({ x, y, width, height });
  }
  return tiles;
}

/**
 * One axis's cuts: the whole span when it fits a tile, else its parts between the grid lines.
 *
 * @param start - The span's start.
 * @param length - Its length.
 * @param tile - The tile edge.
 * @returns Each part's start and length.
 */
function cuts(start: number, length: number, tile: number): [number, number][] {
  if (length <= tile) return [[start, length]];
  const parts: [number, number][] = [];
  const end = start + length;
  let from = start;
  while (from < end) {
    const to = Math.min(end, (Math.floor(from / tile) + 1) * tile);
    parts.push([from, to - from]);
    from = to;
  }
  return parts;
}

/**
 * What a layer rectangle costs as targets: each tile's bucketed resolved colour plus its
 * composite uniform. Pure.
 *
 * @param rect - The rectangle, canvas device pixels.
 * @param tile - The tile edge.
 * @returns The bytes.
 */
export function layerTargetBytes(rect: GpuViewport, tile: number): number {
  let bytes = 0;
  for (const part of layerTiles(rect, tile)) {
    bytes +=
      renderTargetByteLength({
        width: bucketEdge(part.width, tile),
        height: bucketEdge(part.height, tile),
      }) + LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH;
  }
  return bytes;
}

/**
 * The extent of a layer rectangle's targets: its tiles' widest and tallest bucketed edges, what
 * the shared scratch must hold for it. Pure.
 *
 * @param rect - The rectangle, canvas device pixels.
 * @param tile - The tile edge.
 * @returns The extent.
 */
export function layerTargetExtent(rect: GpuViewport, tile: number): LayerExtent {
  let width = 0;
  let height = 0;
  for (const part of layerTiles(rect, tile)) {
    width = Math.max(width, bucketEdge(part.width, tile));
    height = Math.max(height, bucketEdge(part.height, tile));
  }
  return { width, height };
}
