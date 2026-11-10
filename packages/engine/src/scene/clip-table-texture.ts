import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';

import { CLIP_TEXELS_PER_SLOT, type ClipTable } from './clip-table.js';
import type { FrameStats } from './frame-context.js';

/** The clip table's binding in every scene pass's group 0 (`scripts/clip-shader.ts`). */
export const CLIP_TABLE_BINDING = 5;

/**
 * The GPU copy of a {@link ClipTable}: a load-only rgba32float texture, bound at
 * {@link CLIP_TABLE_BINDING} by every scene pass and read with `textureLoad` (`texelFetch` on
 * WebGL2) at texel `slot × 4 + k`, row-major over the texture's width. It holds the table's
 * capacity, at most `maxTextureSize` texels wide; when the table grows the texture is replaced
 * (so bind groups compare `texture` by identity and rebuild) and its used texels are written
 * once; otherwise `flush` writes only the dirty texels, nothing when clean. Created zeroed, so
 * slot 0 reads unclipped before any upload. On the thread that owns the backend.
 */
export class ClipTableTexture {
  private current: GpuTexture;
  private texelCapacity: number;

  /**
   * Allocates the texture for the table's current capacity.
   *
   * @param backend - The backend.
   * @param table - The CPU table, or undefined for a table that stays empty (an overlay that
   *   draws scene passes outside a scene).
   */
  constructor(
    private readonly backend: Pick<GpuBackend, 'capabilities' | 'createTexture' | 'writeTexture'>,
    private readonly table?: ClipTable,
  ) {
    this.texelCapacity = (table?.capacity ?? 1) * CLIP_TEXELS_PER_SLOT;
    this.current = this.create();
  }

  /**
   * The texture to bind; replaced when the table grows.
   *
   * @returns The current texture.
   */
  get texture(): GpuTexture {
    return this.current;
  }

  /**
   * Bytes of GPU texture storage.
   *
   * @returns The allocated bytes, row padding included.
   */
  get byteLength(): number {
    return this.current.width * this.current.height * 16;
  }

  /**
   * Uploads what changed in the table since the last flush. Call with no render pass open.
   *
   * @param stats - The frame's counters, to add the uploaded bytes to.
   */
  flush(stats: Pick<FrameStats, 'uploadedBytes'>): void {
    const { table } = this;
    if (table === undefined) return;
    const capacity = table.capacity * CLIP_TEXELS_PER_SLOT;
    let [start, end] = table.dirtyTexels;
    if (capacity !== this.texelCapacity) {
      this.current.destroy();
      this.texelCapacity = capacity;
      this.current = this.create();
      [start, end] = [0, table.usedSlots * CLIP_TEXELS_PER_SLOT];
    }
    const { width } = this.current;
    while (start < end) {
      const x = start % width;
      const count = Math.min(width - x, end - start);
      this.backend.writeTexture(this.current, table.data.subarray(start * 4, (start + count) * 4), {
        x,
        y: Math.floor(start / width),
        width: count,
        height: 1,
      });
      stats.uploadedBytes += count * 16;
      start += count;
    }
    table.clearDirty();
  }

  /** Frees the texture after the passes binding it are gone. */
  destroy(): void {
    this.current.destroy();
  }

  private create(): GpuTexture {
    const width = Math.min(this.texelCapacity, this.backend.capabilities.maxTextureSize);
    return this.backend.createTexture({
      format: 'rgba32float',
      width,
      height: Math.ceil(this.texelCapacity / width),
      label: 'clip-table',
    });
  }
}
