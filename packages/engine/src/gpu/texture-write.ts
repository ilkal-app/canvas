import type {
  GpuTextureDataLayout,
  GpuTextureDescriptor,
  GpuTextureFormat,
  GpuTextureRegion,
} from './gpu-texture.js';

/** A texture write with every default filled in and every bound checked. */
export interface ResolvedTextureWrite {
  /** The destination rectangle, in texels. */
  readonly region: GpuTextureRegion;
  /** Byte offset of the region's top-left texel in the source bytes. */
  readonly byteOffset: number;
  /** Bytes from one source row to the next. */
  readonly bytesPerRow: number;
  /** Source row length in texels (`bytesPerRow / bytesPerTexel`), as WebGL2's `UNPACK_ROW_LENGTH`. */
  readonly rowLengthTexels: number;
}

/**
 * The size of one texel of a format, in bytes.
 *
 * @param format - The texel format.
 * @returns 16 for `rgba32float`, 4 for `rgba8unorm`, 1 for `r8unorm`.
 */
export function bytesPerTexel(format: GpuTextureFormat): number {
  return format === 'rgba32float' ? 16 : format === 'rgba8unorm' ? 4 : 1;
}

/**
 * Fills in a texture write's defaults (the whole texture, packed rows from byte 0) and checks it,
 * so both backends accept exactly the same uploads.
 *
 * @param texture - The destination texture's format and size.
 * @param sourceByteLength - The size of the source bytes.
 * @param region - The texels to write; the whole texture when omitted.
 * @param layout - Where the region's texels sit in the source; packed from byte 0 when omitted.
 * @returns The resolved region and source layout.
 * @throws {RangeError} When the region leaves the texture, a row is misaligned or the source is
 *   too short.
 */
export function resolveTextureWrite(
  texture: Pick<GpuTextureDescriptor, 'format' | 'width' | 'height'>,
  sourceByteLength: number,
  region?: GpuTextureRegion,
  layout?: GpuTextureDataLayout,
): ResolvedTextureWrite {
  const target = region ?? { x: 0, y: 0, width: texture.width, height: texture.height };
  assertRegionInside(texture, target);
  const texelBytes = bytesPerTexel(texture.format);
  const bytesPerRow = layout?.bytesPerRow ?? target.width * texelBytes;
  const byteOffset = layout?.byteOffset ?? 0;
  if (bytesPerRow < target.width * texelBytes || bytesPerRow % texelBytes !== 0) {
    throw new RangeError(
      `bytesPerRow ${String(bytesPerRow)} must cover ${String(target.width)} texels and be a multiple of ${String(texelBytes)}.`,
    );
  }
  const lastByte =
    target.height === 0
      ? byteOffset
      : byteOffset + (target.height - 1) * bytesPerRow + target.width * texelBytes;
  if (texture.format === 'rgba32float' && byteOffset % 4 !== 0) {
    throw new RangeError('Float texture uploads require four-byte-aligned offsets.');
  }
  if (byteOffset < 0 || lastByte > sourceByteLength) {
    throw new RangeError(
      `The source holds ${String(sourceByteLength)} bytes; the write needs ${String(lastByte)}.`,
    );
  }
  return { region: target, byteOffset, bytesPerRow, rowLengthTexels: bytesPerRow / texelBytes };
}

function assertRegionInside(
  texture: Pick<GpuTextureDescriptor, 'width' | 'height'>,
  region: GpuTextureRegion,
): void {
  const { x, y, width, height } = region;
  const isInside =
    [x, y, width, height].every((value) => Number.isInteger(value) && value >= 0) &&
    x + width <= texture.width &&
    y + height <= texture.height;
  if (!isInside) {
    throw new RangeError(
      `Region (${String(x)}, ${String(y)}, ${String(width)}×${String(height)}) leaves the ${String(texture.width)}×${String(texture.height)} texture.`,
    );
  }
}
