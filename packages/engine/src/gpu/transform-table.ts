import type { GpuBackend } from './gpu-backend.js';
import type { GpuTexture } from './gpu-texture.js';

/** Absolute CPU-computed placement, before the instance float32 boundary. */
export interface TransformTablePlacement {
  /** World x coordinate. */
  readonly x: number;
  /** World y coordinate. */
  readonly y: number;
  /** Rotation cosine. */
  readonly cos: number;
  /** Rotation sine. */
  readonly sin: number;
}

/**
 * Fixed-capacity absolute object placements for a retained move session. Index zero is reserved
 * for ordinary instance placement. The caller owns stable object indices for the table's life.
 * Values cross the float32 boundary here, exactly as they do in ordinary instance records.
 */
export class TransformTable {
  /** Load-only rgba32float texture; each texel is (world x, world y, cos, sin). */
  readonly texture: GpuTexture;
  private readonly values: Float32Array<ArrayBuffer>;
  private firstDirty = Number.POSITIVE_INFINITY;
  private lastDirty = -1;
  private placementRevision = 0;

  /**
   * Allocates the table, reserving texel zero in addition to the requested object capacity.
   *
   * @param backend - The owning backend.
   * @param capacity - Maximum stable object index, inclusive.
   * @throws {RangeError} When the capacity cannot fit exact indices or texture dimensions.
   */
  constructor(
    private readonly backend: Pick<GpuBackend, 'capabilities' | 'createTexture' | 'writeTexture'>,
    private readonly capacity: number,
  ) {
    const limit = backend.capabilities.maxTextureSize;
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity >= Math.min(limit * limit, 2 ** 24)
    ) {
      throw new RangeError('Transform table capacity exceeds exact indices or texture dimensions.');
    }
    const width = Math.min(capacity + 1, limit);
    const height = Math.ceil((capacity + 1) / width);
    this.texture = backend.createTexture({
      format: 'rgba32float',
      width,
      height,
      label: 'move-transform-table',
    });
    this.values = new Float32Array(width * height * 4);
  }

  /**
   * Stores an absolute placement; no rounded-origin delta arithmetic is performed.
   *
   * @param index - Stable object index in [1, capacity].
   * @param transform - The ordinary CPU-computed world placement.
   * @throws {RangeError} When the index is outside the allocated object capacity.
   */
  set(index: number, transform: TransformTablePlacement): void {
    if (!Number.isInteger(index) || index < 1 || index > this.capacity) {
      throw new RangeError('Transform table index is outside its object capacity.');
    }
    const offset = index * 4;
    this.values[offset] = transform.x;
    this.values[offset + 1] = transform.y;
    this.values[offset + 2] = transform.cos;
    this.values[offset + 3] = transform.sin;
    this.firstDirty = Math.min(this.firstDirty, index);
    this.lastDirty = Math.max(this.lastDirty, index);
    this.placementRevision += 1;
  }

  /**
   * Reads the same rounded placement a vertex load observes, for exact CPU bounds checks: the
   * stored placement moved by the session offset (`setOffset`), in float32 as the shader adds it.
   *
   * @param index - Stable object index.
   * @returns The four float32 placement components.
   * @throws {RangeError} When the index is outside the allocated object capacity.
   */
  read(index: number): TransformTablePlacement {
    if (!Number.isInteger(index) || index < 1 || index > this.capacity) {
      throw new RangeError('Transform table index is outside its object capacity.');
    }
    const at = index * 4;
    const { values } = this;
    const dx = values[0] ?? 0;
    const dy = values[1] ?? 0;
    const x = values[at] ?? 0;
    const y = values[at + 1] ?? 0;
    return {
      x: dx === 0 ? x : Math.fround(x + dx),
      y: dy === 0 ? y : Math.fround(y + dy),
      cos: values[at + 2] ?? 0,
      sin: values[at + 3] ?? 0,
    };
  }

  /**
   * Moves every placement by one translation: texel 0, which no object uses, holds it
   * and the move shaders add it, so a frame that translates the whole session writes one texel.
   *
   * @param dx - The translation along x, world units.
   * @param dy - The translation along y.
   */
  setOffset(dx: number, dy: number): void {
    const { values } = this;
    if (values[0] === Math.fround(dx) && values[1] === Math.fround(dy)) return;
    values[0] = dx;
    values[1] = dy;
    this.firstDirty = 0;
    this.lastDirty = Math.max(this.lastDirty, 0);
    this.placementRevision += 1;
  }

  /**
   * Changes whenever a placement is set. Geometry stays clean during moves, so any retained
   * path preparation/visibility cache must include this revision in its placement witness.
   *
   * @returns The monotonically increasing placement revision.
   */
  get revision(): number {
    return this.placementRevision;
  }

  /**
   * Bytes of GPU texture storage (the CPU mirror occupies the same number).
   *
   * @returns Allocated bytes including row padding and the reserved texel.
   */
  get byteLength(): number {
    return this.values.byteLength;
  }

  /**
   * Uploads dirty placements before a render pass; unchanged tables upload nothing.
   *
   * @returns Actual submitted bytes and texture-write calls, for frame accounting.
   */
  flush(): {
    /** Bytes uploaded across all dirty rows. */
    readonly uploadedBytes: number;
    /** Texture writes submitted for those rows. */
    readonly writes: number;
  } {
    let uploadedBytes = 0;
    let writes = 0;
    const width = this.texture.width;
    for (let start = this.firstDirty; start <= this.lastDirty;) {
      const x = start % width;
      const count = Math.min(width - x, this.lastDirty - start + 1);
      this.backend.writeTexture(
        this.texture,
        this.values.subarray(start * 4, (start + count) * 4),
        { x, y: Math.floor(start / width), width: count, height: 1 },
      );
      uploadedBytes += count * 16;
      writes += 1;
      start += count;
    }
    this.firstDirty = Number.POSITIVE_INFINITY;
    this.lastDirty = -1;
    return { uploadedBytes, writes };
  }

  /** Frees the texture after its session and bind groups have stopped using it. */
  destroy(): void {
    this.texture.destroy();
  }
}
