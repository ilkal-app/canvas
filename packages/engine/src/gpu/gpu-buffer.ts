/**
 * What a buffer is bound as: per-vertex or per-instance attributes (`vertex`), or a uniform
 * block (`uniform`). Instance data lives in persistent `vertex` buffers updated by dirty
 * ranges.
 */
export type GpuBufferUsage = 'vertex' | 'uniform';

/** How to create a {@link GpuBuffer}. */
export interface GpuBufferDescriptor {
  /** What the buffer is bound as. */
  readonly usage: GpuBufferUsage;
  /** The buffer's size in bytes; a positive multiple of 4 (a WebGPU copy requirement). */
  readonly byteLength: number;
  /** A name shown by GPU debuggers. */
  readonly label?: string;
}

/**
 * A block of GPU memory. Contents are written with `GpuBackend.writeBuffer`; the handle belongs
 * to the backend that created it and is rejected by any other.
 */
export interface GpuBuffer {
  /** What the buffer is bound as. */
  readonly usage: GpuBufferUsage;
  /** The buffer's size in bytes. */
  readonly byteLength: number;
  /** Frees the GPU memory. The handle must not be used afterwards. */
  destroy(): void;
}

/** Buffer sizes, offsets and write lengths must be multiples of this many bytes. */
export const BUFFER_ALIGNMENT_BYTES = 4;

/**
 * Checks a buffer size before creation.
 *
 * @param byteLength - The requested size in bytes.
 * @throws {RangeError} When the size is not a positive multiple of 4 bytes.
 */
export function assertBufferByteLength(byteLength: number): void {
  if (
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength % BUFFER_ALIGNMENT_BYTES !== 0
  ) {
    throw new RangeError(
      `A GPU buffer's byteLength must be a positive multiple of ${String(BUFFER_ALIGNMENT_BYTES)}; received ${String(byteLength)}.`,
    );
  }
}

/**
 * Checks that a write of `writeByteLength` bytes at `byteOffset` fits a buffer of
 * `bufferByteLength` bytes and meets WebGPU's 4-byte alignment, so both backends accept exactly
 * the same writes.
 *
 * @param bufferByteLength - The destination buffer's size in bytes.
 * @param byteOffset - Where the write starts, in bytes from the buffer start.
 * @param writeByteLength - How many bytes are written.
 * @throws {RangeError} When the offset or length is misaligned or the range overruns the buffer.
 */
export function assertBufferWrite(
  bufferByteLength: number,
  byteOffset: number,
  writeByteLength: number,
): void {
  if (byteOffset % BUFFER_ALIGNMENT_BYTES !== 0 || writeByteLength % BUFFER_ALIGNMENT_BYTES !== 0) {
    throw new RangeError(
      `Buffer writes must be ${String(BUFFER_ALIGNMENT_BYTES)}-byte aligned; received offset ${String(byteOffset)}, length ${String(writeByteLength)}.`,
    );
  }
  if (byteOffset < 0 || byteOffset + writeByteLength > bufferByteLength) {
    throw new RangeError(
      `A write of ${String(writeByteLength)} bytes at ${String(byteOffset)} overruns a ${String(bufferByteLength)}-byte buffer.`,
    );
  }
}
