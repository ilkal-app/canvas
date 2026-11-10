import type { ObjectId } from '@canvas/schema';

import { drawnFrameCornerRadii, hasRoundedCorner } from '../shapes/corner-radii.js';
import type { ClipRect } from '../spatial/clip-chain.js';

/** Texels per clipping frame in the clip table texture. */
export const CLIP_TEXELS_PER_SLOT = 4;

/** Floats per clipping frame: {@link CLIP_TEXELS_PER_SLOT} rgba32float texels. */
export const CLIP_FLOATS_PER_SLOT = CLIP_TEXELS_PER_SLOT * 4;

/** Slots allocated before the first growth, slot 0 included. */
const INITIAL_SLOT_CAPACITY = 16;

/**
 * The CPU side of the clip table: one record of four rgba32float texels per clipping
 * frame that some drawn object is clipped by, read by every scene shader through the record's
 * `clipIndex` (`scripts/clip-shader.ts`):
 *
 * - texel 0: the frame's world origin (x, y) and its world rotation axis (cos, sin);
 * - texel 1: its width and height, world units, the slot of its own nearest clipping ancestor
 *   (0 for none), and 1 when any of its corners is rounded, else 0;
 * - texel 2: the map from the frame's own frame to its clipping ancestor's, as (cos, sin, tx, ty)
 *   (`p' = R p + t`), worked out in float64 so a nested clip does not drift with distance from
 *   the origin; zeros when it has no clipping ancestor;
 * - texel 3: its four corner radii, world units, top-left, top-right, bottom-right, bottom-left,
 *   each capped at half its shorter side (`drawnFrameCornerRadii`); zeros when sharp.
 *
 * Slot 0 is reserved and all zeros: unclipped. Slots are reused through a free list; capacity
 * doubles. Writes that change nothing leave the table clean, so a still frame uploads nothing.
 * CPU-only; `ClipTableTexture` uploads its dirty texels. Owned by the `Scene`.
 */
export class ClipTable {
  private values = new Float32Array(INITIAL_SLOT_CAPACITY * CLIP_FLOATS_PER_SLOT);
  private readonly slots = new Map<ObjectId, number>();
  private readonly free: number[] = [];
  private nextSlot = 1;
  private firstDirty = Number.POSITIVE_INFINITY;
  private lastDirty = -1;
  private readonly scratch = new Float32Array(CLIP_FLOATS_PER_SLOT);

  /**
   * The table's floats, {@link CLIP_FLOATS_PER_SLOT} per slot; replaced when the table grows.
   *
   * @returns The backing store.
   */
  get data(): Float32Array<ArrayBuffer> {
    return this.values;
  }

  /**
   * How many slots the backing store holds, slot 0 included.
   *
   * @returns The capacity.
   */
  get capacity(): number {
    return this.values.length / CLIP_FLOATS_PER_SLOT;
  }

  /**
   * One past the highest slot ever allocated: the slots a texture must hold.
   *
   * @returns The slot count in use, slot 0 included.
   */
  get usedSlots(): number {
    return this.nextSlot;
  }

  /**
   * How many clipping frames hold a slot.
   *
   * @returns The count.
   */
  get size(): number {
    return this.slots.size;
  }

  /**
   * The texels written since `clearDirty`, as `[first, end)`; empty when clean.
   *
   * @returns The dirty texel range.
   */
  get dirtyTexels(): readonly [number, number] {
    if (this.lastDirty < 0) return [0, 0];
    return [this.firstDirty * CLIP_TEXELS_PER_SLOT, (this.lastDirty + 1) * CLIP_TEXELS_PER_SLOT];
  }

  /**
   * A frame's slot.
   *
   * @param id - The frame.
   * @returns Its slot, or 0 when it holds none.
   */
  slotOf(id: ObjectId): number {
    return this.slots.get(id) ?? 0;
  }

  /**
   * Writes a clipping frame's record, allocating its slot on first use.
   *
   * @param rect - The frame's box in the world (`clipRectOf`).
   * @param parent - Its nearest clipping ancestor's box, or undefined for none.
   * @param parentSlot - That ancestor's slot, or 0 for none.
   * @returns The frame's slot.
   */
  set(rect: ClipRect, parent: ClipRect | undefined, parentSlot: number): number {
    const record = this.scratch;
    record.fill(0);
    record[0] = rect.x;
    record[1] = rect.y;
    record[2] = rect.cos;
    record[3] = rect.sin;
    record[4] = rect.width;
    record[5] = rect.height;
    record[6] = parentSlot;
    const radii = drawnFrameCornerRadii(rect.cornerRadius, rect.width, rect.height);
    if (hasRoundedCorner(radii)) {
      record[7] = 1;
      record.set(radii, 12);
    }
    if (parent !== undefined) {
      // R_pᵀ R_f and R_pᵀ (O_f − O_p), in float64 before the float32 boundary.
      const dx = rect.x - parent.x;
      const dy = rect.y - parent.y;
      record[8] = parent.cos * rect.cos + parent.sin * rect.sin;
      record[9] = parent.cos * rect.sin - parent.sin * rect.cos;
      record[10] = parent.cos * dx + parent.sin * dy;
      record[11] = parent.cos * dy - parent.sin * dx;
    }
    const slot = this.slots.get(rect.id) ?? this.allocate(rect.id);
    this.write(slot, record);
    return slot;
  }

  /**
   * Frees a frame's slot and zeroes its record; nothing when it holds none.
   *
   * @param id - The frame.
   */
  release(id: ObjectId): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.slots.delete(id);
    this.scratch.fill(0);
    this.write(slot, this.scratch);
    this.free.push(slot);
  }

  /** Marks every record clean, after an upload. */
  clearDirty(): void {
    this.firstDirty = Number.POSITIVE_INFINITY;
    this.lastDirty = -1;
  }

  private allocate(id: ObjectId): number {
    const slot = this.free.pop() ?? this.nextSlot++;
    if (slot >= this.capacity) {
      const grown = new Float32Array(this.values.length * 2);
      grown.set(this.values);
      this.values = grown;
    }
    this.slots.set(id, slot);
    return slot;
  }

  private write(slot: number, record: Float32Array): void {
    const offset = slot * CLIP_FLOATS_PER_SLOT;
    let isChanged = false;
    for (let index = 0; index < CLIP_FLOATS_PER_SLOT; index++) {
      const value = Math.fround(record[index] ?? 0);
      if (Object.is(this.values[offset + index], value)) continue;
      this.values[offset + index] = value;
      isChanged = true;
    }
    if (!isChanged) return;
    this.firstDirty = Math.min(this.firstDirty, slot);
    this.lastDirty = Math.max(this.lastDirty, slot);
  }
}
