import type { GpuBackend } from '../../gpu/gpu-backend.js';
import { renderTargetByteLength, type GpuRenderTarget } from '../../gpu/gpu-render-target.js';

import { bucketEdge, LAYER_IDLE_RELEASE_MS, type LayerExtent } from './layer-budget.js';

/** How much larger than a tile's bucket its own target may be and still be kept: 4× the area. */
const MAX_WASTE = 4;

/** A pooled target and who used it when. */
interface Pooled {
  readonly target: GpuRenderTarget;
  /** The tile that last drew into it (`layerId#index`). */
  owner: string;
  /** The frame that last took it. */
  frameIndex: number;
  /** That frame's time, ms. */
  lastUsedMs: number;
}

/**
 * The layer tiles' render targets, pooled by size: each is a tile's rectangle
 * rounded up to 64 px buckets (`bucketEdge`), so a slow zoom keeps drawing into the same
 * targets; a tile takes the target it drew into last while that holds its bucket at no more than
 * four times its area (so a zoom out, or back in after one, makes nothing), else any free one of
 * its bucket, else a new one. A target no frame took for over two seconds
 * (`LAYER_IDLE_RELEASE_MS`) is destroyed, and idle ones go first, oldest first, whenever the
 * pool is over a byte limit. Counts the resolved colour it holds. The rendering thread.
 */
export class LayerTargetPool {
  private readonly pooled: Pooled[] = [];
  /** Each target by the tile that last drew into it. */
  private readonly byOwner = new Map<string, Pooled>();
  private bytes = 0;
  /** The holdings by layer, kept until a target is made, destroyed or changes hands. */
  private held: Map<string, number> | undefined;
  /** Each layer's targets' extent, kept as {@link LayerTargetPool.held} is. */
  private heldExtents: Map<string, LayerExtent> | undefined;
  /** The pooled targets' extent, kept until a target is made or destroyed. */
  private poolExtent: LayerExtent | undefined;

  /**
   * Creates an empty pool.
   *
   * @param backend - The backend that makes the targets.
   * @param tile - The largest edge a target may have.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly tile: number,
  ) {}

  /**
   * How many targets are pooled, idle ones included.
   *
   * @returns The count.
   */
  get size(): number {
    return this.pooled.length;
  }

  /**
   * The bytes of resolved colour the pooled targets hold.
   *
   * @returns The bytes.
   */
  get byteLength(): number {
    return this.bytes;
  }

  /**
   * The pooled targets' widest width and tallest height, idle ones included: the extent the
   * backend's shared scratch takes for them (`RenderTargetExtent`).
   *
   * @returns The extent; zero by zero when the pool is empty.
   */
  get extent(): LayerExtent {
    if (this.poolExtent === undefined) {
      let width = 0;
      let height = 0;
      for (const { target } of this.pooled) {
        width = Math.max(width, target.width);
        height = Math.max(height, target.height);
      }
      this.poolExtent = { width, height };
    }
    return this.poolExtent;
  }

  /**
   * A target for a tile this frame: at least its size, in 64 px buckets, taken by no other
   * tile this frame.
   *
   * @param owner - The tile (`layerId#index`).
   * @param size - The tile's size in device pixels.
   * @param size.width - Its width.
   * @param size.height - Its height.
   * @param frameIndex - The frame.
   * @param timeMs - The frame's time.
   * @returns The target.
   */
  acquire(
    owner: string,
    size: { readonly width: number; readonly height: number },
    frameIndex: number,
    timeMs: number,
  ): GpuRenderTarget {
    const width = bucketEdge(size.width, this.tile);
    const height = bucketEdge(size.height, this.tile);
    const isFree = (item: Pooled): boolean =>
      item.frameIndex !== frameIndex &&
      item.target.width === width &&
      item.target.height === height;
    // Its own target while it holds the tile without wasting much: a zoom out keeps it.
    const own = this.byOwner.get(owner);
    const isOwnFit =
      own !== undefined &&
      own.frameIndex !== frameIndex &&
      own.target.width >= width &&
      own.target.height >= height &&
      own.target.width * own.target.height <= MAX_WASTE * width * height;
    let item = isOwnFit ? own : this.pooled.find(isFree);
    if (item === undefined) {
      item = {
        target: this.backend.createRenderTarget({ width, height }),
        owner,
        frameIndex,
        lastUsedMs: timeMs,
      };
      this.pooled.push(item);
      this.bytes += renderTargetByteLength(item.target);
      this.held = undefined;
      this.poolExtent = undefined;
    }
    if (item.owner !== owner) {
      this.held = undefined;
      if (this.byOwner.get(item.owner) === item) this.byOwner.delete(item.owner);
    }
    item.owner = owner;
    this.byOwner.set(owner, item);
    item.frameIndex = frameIndex;
    item.lastUsedMs = timeMs;
    return item.target;
  }

  /**
   * Destroys the targets idle for over two seconds, then, while the pool holds more than
   * `byteLimit`, the other targets this frame did not take, oldest first.
   *
   * @param frameIndex - The frame.
   * @param timeMs - The frame's time.
   * @param byteLimit - The most the pool may keep, bytes.
   */
  releaseIdle(frameIndex: number, timeMs: number, byteLimit: number): void {
    if (this.pooled.every((item) => item.frameIndex === frameIndex)) return;
    const idle = this.pooled
      .filter((item) => item.frameIndex !== frameIndex)
      .sort((a, b) => a.lastUsedMs - b.lastUsedMs);
    for (const item of idle) {
      if (timeMs - item.lastUsedMs > LAYER_IDLE_RELEASE_MS || this.bytes > byteLimit) {
        this.destroy(item);
      }
    }
  }

  /**
   * The bytes each layer's tiles last held, by layer: what keeping its targets costs. The same
   * map while no target is made, destroyed or changes hands.
   *
   * @returns The bytes by layer id (an owner's `layerId#index` less its index).
   */
  heldBytesByLayer(): ReadonlyMap<string, number> {
    if (this.held !== undefined) return this.held;
    const bytes = new Map<string, number>();
    const extents = new Map<string, LayerExtent>();
    for (const { owner, target } of this.pooled) {
      const layer = owner.slice(0, owner.lastIndexOf('#'));
      bytes.set(layer, (bytes.get(layer) ?? 0) + renderTargetByteLength(target));
      const extent = extents.get(layer);
      extents.set(layer, {
        width: Math.max(extent?.width ?? 0, target.width),
        height: Math.max(extent?.height ?? 0, target.height),
      });
    }
    this.held = bytes;
    this.heldExtents = extents;
    return bytes;
  }

  /**
   * The extent each layer's tiles last held, by layer: what the scratch needs for its targets.
   * Read with {@link LayerTargetPool.heldBytesByLayer}, and the same map while it is.
   *
   * @returns The widest width and tallest height by layer id.
   */
  heldExtentByLayer(): ReadonlyMap<string, LayerExtent> {
    this.heldBytesByLayer();
    return this.heldExtents ?? new Map();
  }

  /** Destroys every target. */
  destroyAll(): void {
    for (const item of [...this.pooled]) this.destroy(item);
  }

  /**
   * Destroys one target.
   *
   * @param item - The pooled target.
   */
  private destroy(item: Pooled): void {
    this.pooled.splice(this.pooled.indexOf(item), 1);
    if (this.byOwner.get(item.owner) === item) this.byOwner.delete(item.owner);
    this.held = undefined;
    this.poolExtent = undefined;
    this.bytes -= renderTargetByteLength(item.target);
    item.target.destroy();
  }
}
