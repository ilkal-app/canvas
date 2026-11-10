import type { GpuTextureFormat, GpuTextureRegion } from '../../gpu/gpu-texture.js';

import type { GlyphBitmap, GlyphField } from './glyph-bitmap.js';

/**
 * Texels to copy into an atlas page texture: one glyph's cell, packed rows in the page's format.
 * The renderer applies uploads with `GpuBackend.writeTexture` before it begins a pass (writes
 * are rejected inside an open pass).
 */
export interface AtlasUpload {
  /** The page. */
  readonly pageId: number;
  /** The cell, in texels of the page. */
  readonly region: GpuTextureRegion;
  /** The cell's texels: 4 bytes each for `rgba8unorm` pages, 1 for `r8unorm`. */
  readonly texels: Uint8Array<ArrayBuffer>;
}

/**
 * Lays a glyph bitmap into its cell: the bitmap in the middle, a cleared gutter of `gutter`
 * texels around it (read as "far outside" by the shader), RGB expanded to RGBA with opaque alpha
 * for an MSDF glyph; a colour glyph's RGBA rows copied as they are.
 *
 * @param bitmap - The glyph's field.
 * @param format - The page's texel format.
 * @param gutter - Cleared texels on each side.
 * @returns The cell's texels, packed rows.
 */
export function cellTexels(
  bitmap: GlyphBitmap,
  format: GpuTextureFormat,
  gutter: number,
): Uint8Array<ArrayBuffer> {
  const cellWidth = bitmap.width + 2 * gutter;
  const texelBytes = format === 'rgba8unorm' ? 4 : 1;
  const texels = new Uint8Array(cellWidth * (bitmap.height + 2 * gutter) * texelBytes);
  const { pixels, width } = bitmap;
  for (let row = 0; row < bitmap.height; row += 1) {
    const target = ((row + gutter) * cellWidth + gutter) * texelBytes;
    if (texelBytes === 1 || bitmap.field === 'colour') {
      // Single-channel, or a colour glyph's RGBA already: the row as it is.
      const rowBytes = width * texelBytes;
      texels.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), target);
      continue;
    }
    for (let column = 0; column < width; column += 1) {
      const from = (row * width + column) * 3;
      const to = target + column * 4;
      texels[to] = pixels[from] ?? 0;
      texels[to + 1] = pixels[from + 1] ?? 0;
      texels[to + 2] = pixels[from + 2] ?? 0;
      texels[to + 3] = 255;
    }
  }
  return texels;
}

/**
 * The texel format of a page holding glyphs of a kind.
 *
 * @param field - The glyphs' kind.
 * @returns `r8unorm` for single-channel glyphs, else `rgba8unorm`.
 */
export function pageFormatOf(field: GlyphField): GpuTextureFormat {
  return field === 'sdf' ? 'r8unorm' : 'rgba8unorm';
}
