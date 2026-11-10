import type { GpuRenderTargetDescriptor } from './gpu-render-target.js';

/**
 * The live render targets of a backend and the extent its shared scratch needs: the widest
 * width and the tallest height among them. Both backends draw a target pass into one
 * multisampled colour and stencil scratch of this extent, at its top-left (WebGPU) or bottom-left
 * (WebGL2) corner, and then resolve the target's part into its texture; so the scratch costs
 * memory once, not per target. Pure bookkeeping.
 */
export class RenderTargetExtent {
  private readonly sizes = new Map<object, GpuRenderTargetDescriptor>();

  /**
   * How many targets are live.
   *
   * @returns The count.
   */
  get liveCount(): number {
    return this.sizes.size;
  }

  /**
   * Counts a new target.
   *
   * @param target - The target, as a key.
   * @param size - Its size in device pixels.
   */
  add(target: object, size: GpuRenderTargetDescriptor): void {
    this.sizes.set(target, { width: size.width, height: size.height });
  }

  /**
   * Stops counting a destroyed target.
   *
   * @param target - The target given to `add`.
   * @returns Whether it was live.
   */
  delete(target: object): boolean {
    return this.sizes.delete(target);
  }

  /**
   * The scratch extent every live target fits in, and `minimum` too: the size of the target a
   * pass is about to draw into.
   *
   * @param minimum - A size the extent must hold even if no target is live.
   * @returns The widest width and tallest height.
   */
  required(minimum: GpuRenderTargetDescriptor): GpuRenderTargetDescriptor {
    let { width, height } = minimum;
    for (const size of this.sizes.values()) {
      width = Math.max(width, size.width);
      height = Math.max(height, size.height);
    }
    return { width, height };
  }
}

/**
 * Whether a scratch must be (re)allocated to match the extent: when there is none, or its size
 * differs from the required one. It shrinks as well as grows, so a large target's scratch is not
 * kept once that target is gone. Pure.
 *
 * @param current - The scratch's size, or `undefined` when none is allocated.
 * @param required - The extent the live targets need.
 * @returns True when the scratch should be recreated at `required`.
 */
export function isScratchStale(
  current: GpuRenderTargetDescriptor | undefined,
  required: GpuRenderTargetDescriptor,
): boolean {
  return current?.width !== required.width || current.height !== required.height;
}
