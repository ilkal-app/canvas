// The path records as a data texture, so a batched draw's vertices can each read their
// own path's record (path-batch.wgsl), which an instance buffer cannot give: a draw steps one
// instance for all its vertices.
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';
import type { InstanceBuffer } from '../scene/instance-buffer.js';

/** Texels per record slot: placement, colour, then (clip, transparency, 0, move index). */
export const PATH_RECORD_TEXELS = 3;

const FLOATS_PER_SLOT = PATH_RECORD_TEXELS * 4;

/**
 * The path pass's records for the batched strokes, as an rgba32float texture of
 * {@link PATH_RECORD_TEXELS} texels per slot, row-major (texel `slot × 3 + k` at
 * `(i % width, i / width)`, as the clip table is): the placement (cos, sin, x, y), the
 * straight-alpha colour, then the clip slot, the layer transparency, 0 and the retained-move
 * index (0 for none). A CPU copy is compared with the instance records of the slots the frame
 * batches, and only the texels that differ are uploaded; it grows with the instance buffer.
 */
export class PathRecordTexture {
  private current: GpuTexture | undefined;
  private values = new Float32Array(0);
  /** One slot's floats, assembled before comparing (texel 2's third float stays 0). */
  private readonly scratch = new Float32Array(FLOATS_PER_SLOT);
  private slotCapacity = 0;
  private firstDirty = Number.POSITIVE_INFINITY;
  private lastDirty = -1;
  private changes = 0;

  /**
   * Creates an empty texture; the first `sync` sizes it.
   *
   * @param backend - The backend that creates and writes it.
   * @param label - A name for GPU debuggers.
   */
  constructor(
    private readonly backend: Pick<GpuBackend, 'capabilities' | 'createTexture' | 'writeTexture'>,
    private readonly label: string,
  ) {}

  /**
   * The texture to bind; a one-slot texture before the first `sync`.
   *
   * @returns The texture.
   */
  get texture(): GpuTexture {
    return this.current ?? this.grow(1);
  }

  /**
   * Goes up whenever a texel changes or the texture is replaced.
   *
   * @returns The revision.
   */
  get revision(): number {
    return this.changes;
  }

  /**
   * A slot's twelve floats, as uploaded: for tests.
   *
   * @param slot - The record slot.
   * @returns A copy of its three texels.
   */
  texelsOf(slot: number): Float32Array {
    return this.values.slice(slot * FLOATS_PER_SLOT, (slot + 1) * FLOATS_PER_SLOT);
  }

  /**
   * Brings the given slots' texels up to date with their instance records and move indices.
   *
   * @param instances - The path pass's instance buffer.
   * @param slots - The slots to update.
   * @param moveIndexOf - A slot's retained-move index, 0 for none.
   */
  sync(
    instances: InstanceBuffer,
    slots: Iterable<number>,
    moveIndexOf: (slot: number) => number,
  ): void {
    if (this.slotCapacity < instances.capacity) this.grow(instances.capacity);
    const { data, layout } = instances;
    const stride = layout.floatsPerRecord;
    const clip = layout.clipFloat;
    const opacity = layout.opacityFloat;
    const { values, scratch } = this;
    for (const slot of slots) {
      const record = slot * stride;
      const at = slot * FLOATS_PER_SLOT;
      for (let index = 0; index < 8; index += 1) scratch[index] = data[record + index] ?? 0;
      scratch[8] = clip === undefined ? 0 : (data[record + clip] ?? 0);
      scratch[9] = opacity === undefined ? 0 : (data[record + opacity] ?? 0);
      scratch[11] = moveIndexOf(slot);
      let isSame = true;
      for (let index = 0; index < FLOATS_PER_SLOT && isSame; index += 1) {
        isSame = values[at + index] === scratch[index];
      }
      if (isSame) continue;
      values.set(scratch, at);
      this.firstDirty = Math.min(this.firstDirty, slot * PATH_RECORD_TEXELS);
      this.lastDirty = Math.max(this.lastDirty, slot * PATH_RECORD_TEXELS + PATH_RECORD_TEXELS - 1);
      this.changes += 1;
    }
  }

  /**
   * Uploads the texels changed since the last flush, one write per texture row they cover.
   *
   * @returns The bytes and writes.
   */
  flush(): { readonly uploadedBytes: number; readonly writes: number } {
    const texture = this.texture;
    const { width } = texture;
    let uploadedBytes = 0;
    let writes = 0;
    for (let start = this.firstDirty; start <= this.lastDirty;) {
      const x = start % width;
      const count = Math.min(width - x, this.lastDirty - start + 1);
      const texels = this.values.subarray(start * 4, (start + count) * 4);
      this.backend.writeTexture(texture, texels, {
        x,
        y: Math.floor(start / width),
        width: count,
        height: 1,
      });
      uploadedBytes += texels.byteLength;
      writes += 1;
      start += count;
    }
    this.firstDirty = Number.POSITIVE_INFINITY;
    this.lastDirty = -1;
    return { uploadedBytes, writes };
  }

  /** Frees the texture. */
  destroy(): void {
    this.current?.destroy();
    this.current = undefined;
  }

  private grow(slots: number): GpuTexture {
    const limit = this.backend.capabilities.maxTextureSize;
    const texels = Math.max(1, slots) * PATH_RECORD_TEXELS;
    const width = Math.min(texels, limit);
    const height = Math.ceil(texels / width);
    if (height > limit || texels >= 2 ** 24) {
      throw new RangeError('The path records exceed the record texture or exact float indices.');
    }
    const values = new Float32Array(width * height * 4);
    values.set(this.values.subarray(0, Math.min(this.values.length, values.length)));
    this.current?.destroy();
    const texture = this.backend.createTexture({
      format: 'rgba32float',
      width,
      height,
      label: this.label,
    });
    this.current = texture;
    this.values = values;
    this.slotCapacity = Math.floor((width * height) / PATH_RECORD_TEXELS);
    this.firstDirty = 0;
    this.lastDirty = this.slotCapacity * PATH_RECORD_TEXELS - 1;
    this.changes += 1;
    return texture;
  }
}
