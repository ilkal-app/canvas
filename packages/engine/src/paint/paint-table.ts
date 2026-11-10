import type { Gradient, ObjectId } from '@canvas/schema';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';

import {
  GRADIENT_RECORD_FLOATS,
  GRADIENT_RECORD_TEXELS,
  packGradientRecord,
} from './gradient-record.js';

/**
 * Gradient records per texture row: the table is `11 × 64 = 704` texels wide, inside WebGL2's
 * smallest maximum texture size (2048), so a record never straddles a row and the shaders find
 * record `r` at texel `((r mod 64) × 11, ⌊r / 64⌋)`.
 */
export const PAINT_TABLE_RECORDS_PER_ROW = 64;

/** The rows a table starts with; it doubles as it fills. */
const INITIAL_ROWS = 1;

/** What a flush uploaded. */
export interface PaintTableUpload {
  /** Bytes uploaded. */
  readonly uploadedBytes: number;
  /** Texture writes submitted. */
  readonly writes: number;
}

/**
 * The scene's paint table: one load-only `rgba32float` texture of fixed-size
 * gradient records ({@link packGradientRecord}), one per gradient-filled object, which the
 * gradient variants of the shape, path and frame-background passes read by the record's index
 * (`textureLoad` on WebGPU, `texelFetch` on WebGL2; the pattern of `TransformTable`). Record 0 is
 * reserved: an instance whose index is 0 draws its record's solid colour (the level-of-detail
 * average). A record is allocated with its object and rewritten only when its paint changes;
 * dirty records upload before drawing, so a frame with no paint change uploads nothing. The
 * texture is created on the first upload: a board without a gradient has none. CPU mirror and
 * texture on the rendering thread.
 */
export class PaintTable {
  private gpuTexture: GpuTexture | undefined;
  private values: Float32Array<ArrayBuffer>;
  private readonly scratch = new Float32Array(GRADIENT_RECORD_FLOATS);
  private readonly records = new Map<ObjectId, number>();
  private readonly free: number[] = [];
  private nextRecord = 1;
  private firstDirty = Number.POSITIVE_INFINITY;
  private lastDirty = -1;

  /**
   * Creates an empty table; no GPU memory until a record is written and flushed.
   *
   * @param backend - The backend the texture is created on.
   */
  constructor(
    private readonly backend: Pick<GpuBackend, 'capabilities' | 'createTexture' | 'writeTexture'>,
  ) {
    this.values = new Float32Array(
      INITIAL_ROWS * PAINT_TABLE_RECORDS_PER_ROW * GRADIENT_RECORD_FLOATS,
    );
  }

  /**
   * The texture, once a flush created it.
   *
   * @returns The texture, or undefined while the table has never held a record.
   */
  get texture(): GpuTexture | undefined {
    return this.gpuTexture;
  }

  /**
   * The objects holding a record.
   *
   * @returns The count.
   */
  get recordCount(): number {
    return this.records.size;
  }

  /**
   * Bytes of GPU texture storage: 0 before the first flush.
   *
   * @returns The bytes.
   */
  get byteLength(): number {
    return this.gpuTexture === undefined ? 0 : this.values.byteLength;
  }

  /**
   * Writes an object's gradient into its record, allocating one for a new object; an unchanged
   * gradient marks nothing dirty.
   *
   * @param id - The object.
   * @param gradient - Its paint, as the schema accepts it.
   * @returns The record's index, at least 1: what the variant's instance record holds.
   */
  write(id: ObjectId, gradient: Gradient): number {
    let record = this.records.get(id);
    if (record === undefined) {
      record = this.free.pop() ?? this.nextRecord++;
      this.records.set(id, record);
      this.ensureCapacity(record);
    }
    packGradientRecord(gradient, this.scratch);
    const at = record * GRADIENT_RECORD_FLOATS;
    let isSame = true;
    for (let index = 0; index < GRADIENT_RECORD_FLOATS; index += 1) {
      if (!Object.is(this.values[at + index], this.scratch[index])) isSame = false;
    }
    if (isSame) return record;
    this.values.set(this.scratch, at);
    this.firstDirty = Math.min(this.firstDirty, record);
    this.lastDirty = Math.max(this.lastDirty, record);
    return record;
  }

  /**
   * The record an object holds.
   *
   * @param id - The object.
   * @returns Its index, or undefined.
   */
  recordOf(id: ObjectId): number | undefined {
    return this.records.get(id);
  }

  /**
   * The floats of a record, as the shaders read them (for tests and diagnostics).
   *
   * @param record - The record's index.
   * @returns A copy of its {@link GRADIENT_RECORD_FLOATS} floats.
   */
  read(record: number): Float32Array {
    const at = record * GRADIENT_RECORD_FLOATS;
    return this.values.slice(at, at + GRADIENT_RECORD_FLOATS);
  }

  /**
   * Frees an object's record for reuse; nothing is uploaded, no instance reads it any more.
   *
   * @param id - The object.
   */
  release(id: ObjectId): void {
    const record = this.records.get(id);
    if (record === undefined) return;
    this.records.delete(id);
    this.free.push(record);
  }

  /**
   * Uploads the dirty records, creating the texture on the first upload and recreating it (and
   * uploading every record) when the table has grown. Nothing dirty: no write.
   *
   * @returns Bytes and writes, for the frame's statistics.
   */
  flush(): PaintTableUpload {
    if (this.lastDirty < 0) return { uploadedBytes: 0, writes: 0 };
    const width = PAINT_TABLE_RECORDS_PER_ROW * GRADIENT_RECORD_TEXELS;
    const height = this.values.length / (width * 4);
    let texture = this.gpuTexture;
    if (texture?.height !== height) {
      texture?.destroy();
      texture = this.backend.createTexture({
        format: 'rgba32float',
        width,
        height,
        label: 'paint-table',
      });
      this.gpuTexture = texture;
      this.firstDirty = 0;
      this.lastDirty = Math.max(this.lastDirty, this.nextRecord - 1);
    }
    let uploadedBytes = 0;
    let writes = 0;
    for (let start = this.firstDirty; start <= this.lastDirty;) {
      const column = start % PAINT_TABLE_RECORDS_PER_ROW;
      const count = Math.min(PAINT_TABLE_RECORDS_PER_ROW - column, this.lastDirty - start + 1);
      this.backend.writeTexture(
        texture,
        this.values.subarray(
          start * GRADIENT_RECORD_FLOATS,
          (start + count) * GRADIENT_RECORD_FLOATS,
        ),
        {
          x: column * GRADIENT_RECORD_TEXELS,
          y: Math.floor(start / PAINT_TABLE_RECORDS_PER_ROW),
          width: count * GRADIENT_RECORD_TEXELS,
          height: 1,
        },
      );
      uploadedBytes += count * GRADIENT_RECORD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
      writes += 1;
      start += count;
    }
    this.firstDirty = Number.POSITIVE_INFINITY;
    this.lastDirty = -1;
    return { uploadedBytes, writes };
  }

  /** Frees the texture; the table can be filled and flushed again. */
  destroy(): void {
    this.gpuTexture?.destroy();
    this.gpuTexture = undefined;
  }

  /**
   * Grows the mirror (doubling its rows) until it holds a record.
   *
   * @param record - The record's index.
   * @throws {RangeError} When the table would pass the backend's texture size.
   */
  private ensureCapacity(record: number): void {
    const perRow = PAINT_TABLE_RECORDS_PER_ROW * GRADIENT_RECORD_FLOATS;
    let rows = this.values.length / perRow;
    if (record < rows * PAINT_TABLE_RECORDS_PER_ROW) return;
    while (record >= rows * PAINT_TABLE_RECORDS_PER_ROW) rows *= 2;
    if (rows > this.backend.capabilities.maxTextureSize) {
      throw new RangeError('The paint table has outgrown the largest texture.');
    }
    const grown = new Float32Array(rows * perRow);
    grown.set(this.values);
    this.values = grown;
  }
}
