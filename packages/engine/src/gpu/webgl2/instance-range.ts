import type { GpuVertexStepMode } from '../vertex-layout.js';

/**
 * Where record 0 of a draw starts in a bound vertex buffer. WebGL2 has no base instance, so a
 * draw of an instance range re-aims every per-instance attribute at the range's first record
 * (the prototype's `drawInstanceRange`, `src/render/gl.ts`). Per-vertex buffers need nothing:
 * `drawArraysInstanced` takes the first vertex itself.
 *
 * @param stepMode - Whether the buffer is per vertex or per instance.
 * @param byteStride - Bytes per record.
 * @param bufferByteOffset - The offset the buffer was bound at, in bytes.
 * @param firstInstance - The draw's first instance record.
 * @returns The byte offset of the draw's first record.
 */
export function firstRecordByteOffset(
  stepMode: GpuVertexStepMode,
  byteStride: number,
  bufferByteOffset: number,
  firstInstance: number,
): number {
  return stepMode === 'instance' ? bufferByteOffset + firstInstance * byteStride : bufferByteOffset;
}
