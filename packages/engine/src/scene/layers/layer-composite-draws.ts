import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBindGroup } from '../../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../../gpu/gpu-buffer.js';
import type { GpuViewport } from '../../gpu/gpu-render-pass.js';
import type { GpuRenderTarget } from '../../gpu/gpu-render-target.js';
import type { GpuTexture } from '../../gpu/gpu-texture.js';
import {
  LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH,
  layerCompositeResources,
} from '../../gpu/layer-composite-pass.js';
import type { FrameContext } from '../frame-context.js';

import { LAYER_IDLE_RELEASE_MS } from './layer-budget.js';

/**
 * Whether two uniforms hold the same values.
 *
 * @param a - One.
 * @param b - The other, as long.
 * @returns True when every float is equal.
 */
function isSame(a: Float32Array, b: Float32Array): boolean {
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** A pass a composite draws into: the canvas, or one tile of the parent layer. */
export interface CompositeDestination {
  /** Its key: `canvas`, or the parent tile's `layerId#index`. */
  readonly key: string;
  /** Its rectangle in canvas device pixels. */
  readonly rect: GpuViewport;
  /** Its size in device pixels: its viewport is all of it. */
  readonly size: { readonly width: number; readonly height: number };
}

/** A pooled composite uniform and the bind group made with it. */
interface PooledUniform {
  readonly buffer: GpuBuffer;
  bindGroup: GpuBindGroup | undefined;
  /** The texture the bind group samples. */
  texture: GpuTexture | undefined;
  lastUsedMs: number;
  /** What its buffer holds, so an unchanged uniform is not written again. */
  readonly values: Float32Array;
}

/**
 * The frame's composite draws: one uniform per tile and destination, from a pool
 * reused frame to frame in order (each keeps its bind group while it samples the same target,
 * and is written only when its values change, so a still frame uploads nothing),
 * grouped by destination and composite slot for `LayerCompositor.drawEntry`. Uniforms past
 * those a frame used are freed after two seconds idle. The rendering thread.
 */
export class LayerCompositeDraws {
  private readonly uniforms: PooledUniform[] = [];
  private used = 0;
  private readonly byDestination = new Map<string, Map<number, GpuBindGroup[]>>();

  /**
   * Creates an empty set.
   *
   * @param backend - The backend the uniforms and bind groups are made on.
   */
  constructor(private readonly backend: GpuBackend) {}

  /**
   * How many uniforms are pooled.
   *
   * @returns The count.
   */
  get size(): number {
    return this.uniforms.length;
  }

  /**
   * The bytes the pooled uniforms hold.
   *
   * @returns The bytes.
   */
  get byteLength(): number {
    return this.uniforms.length * LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH;
  }

  /** Starts a frame: no draw yet. */
  begin(): void {
    this.used = 0;
    // Lists are emptied and kept for the next frame; those the last frame left empty go.
    for (const [destination, bySlot] of this.byDestination) {
      for (const [slot, groups] of bySlot) {
        if (groups.length === 0) bySlot.delete(slot);
        else groups.length = 0;
      }
      if (bySlot.size === 0) this.byDestination.delete(destination);
    }
  }

  /**
   * Adds a composite draw: writes its uniform and files its bind group under its destination.
   *
   * @param destination - The destination's key.
   * @param slot - The layer's composite slot.
   * @param target - The tile's target.
   * @param data - The uniform (`layerCompositeUniform`); read, not kept.
   * @param context - The frame, for its time and statistics.
   */
  add(
    destination: string,
    slot: number,
    target: GpuRenderTarget,
    data: Float32Array<ArrayBuffer>,
    context: FrameContext,
  ): void {
    let uniform = this.uniforms[this.used];
    if (uniform === undefined) {
      uniform = {
        buffer: this.backend.createBuffer({
          usage: 'uniform',
          byteLength: LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH,
          label: 'layer-composite layer',
        }),
        bindGroup: undefined,
        texture: undefined,
        lastUsedMs: context.timeMs,
        values: new Float32Array(LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH / 4).fill(Number.NaN),
      };
      this.uniforms.push(uniform);
    }
    this.used += 1;
    uniform.lastUsedMs = context.timeMs;
    if (!isSame(uniform.values, data)) {
      uniform.values.set(data);
      this.backend.writeBuffer(uniform.buffer, 0, data.slice());
      context.stats.bufferWrites += 1;
      context.stats.uploadedBytes += LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH;
    }
    if (uniform.bindGroup === undefined || uniform.texture !== target.texture) {
      const { pipeline, sampler } = layerCompositeResources(this.backend);
      uniform.bindGroup = this.backend.createBindGroup({
        pipeline,
        entries: [
          { binding: 0, buffer: uniform.buffer },
          { binding: 1, texture: target.texture },
          { binding: 2, sampler },
        ],
      });
      uniform.texture = target.texture;
    }
    let bySlot = this.byDestination.get(destination);
    if (bySlot === undefined) {
      bySlot = new Map();
      this.byDestination.set(destination, bySlot);
    }
    const groups = bySlot.get(slot);
    if (groups === undefined) bySlot.set(slot, [uniform.bindGroup]);
    else groups.push(uniform.bindGroup);
  }

  /**
   * The frame's draws into a destination.
   *
   * @param destination - Its key.
   * @returns Each composite slot's bind groups, or undefined for none.
   */
  into(destination: string): ReadonlyMap<number, readonly GpuBindGroup[]> | undefined {
    return this.byDestination.get(destination);
  }

  /**
   * Frees the uniforms past those this frame used that no frame used for over two seconds.
   *
   * @param timeMs - The frame's time.
   */
  releaseIdle(timeMs: number): void {
    while (this.uniforms.length > this.used) {
      const last = this.uniforms.at(-1);
      if (last === undefined || timeMs - last.lastUsedMs <= LAYER_IDLE_RELEASE_MS) return;
      this.uniforms.pop();
      last.buffer.destroy();
    }
  }

  /** Frees every uniform. */
  destroyAll(): void {
    for (const uniform of this.uniforms.splice(0)) uniform.buffer.destroy();
    this.byDestination.clear();
    this.used = 0;
  }
}
