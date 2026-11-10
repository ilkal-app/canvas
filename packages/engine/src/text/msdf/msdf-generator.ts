import { DISTANCE_RANGE_PX, GLYPH_PADDING_PX, type GlyphBitmap } from '../atlas/glyph-bitmap.js';

import type { MsdfgenFont, MsdfgenModule } from './msdfgen-module.js';

/**
 * Loads a font file into msdfgen. The WebAssembly build reads fonts through stb_truetype
 * (TrueType and CFF outlines; a `.ttc` collection's first face).
 *
 * @param module - The msdfgen module.
 * @param bytes - The font file.
 * @returns The loaded font; call `delete()` when done with it.
 * @throws {Error} When msdfgen cannot read the file.
 */
export function loadMsdfgenFont(module: MsdfgenModule, bytes: ArrayBuffer): MsdfgenFont {
  const vector = new module.VectorUnsignedChar();
  for (const byte of new Uint8Array(bytes)) vector.push_back(byte);
  const font = new module.Font();
  const isLoaded = font.loadFromMemory(vector);
  vector.delete();
  if (!isLoaded) {
    font.delete();
    throw new Error('msdfgen cannot read the font file.');
  }
  return font;
}

/**
 * Generates one glyph's multi-channel distance field at a tier (the per-glyph core of the
 * prototype's msdfgen worker, `@zappar/msdf-generator`'s `generateAtlas`, without its atlas
 * packing: the engine's atlas packs). The bitmap spans the glyph's bounds snapped outwards to
 * whole texels plus {@link GLYPH_PADDING_PX}, and the shape is translated so its snapped bounds
 * land exactly on the padding: then `left` and `top` place the quad with no sub-texel error.
 * The field encodes `0.5 + d / DISTANCE_RANGE_PX`, the same as the raster fallback.
 *
 * @param font - A font loaded with {@link loadMsdfgenFont}.
 * @param codepoint - The character.
 * @param tier - Texels per em.
 * @returns The glyph's `msdf` bitmap, rows top to bottom; empty (0 × 0) for a glyph without an
 *   outline, such as the space.
 */
export function generateMsdfGlyph(font: MsdfgenFont, codepoint: number, tier: number): GlyphBitmap {
  const shape = font.getGlyphShape(codepoint);
  const advance = shape.advance * tier;
  if (shape.right <= shape.left || shape.top <= shape.bottom) {
    return {
      field: 'msdf',
      width: 0,
      height: 0,
      pixels: new Uint8Array(0),
      left: 0,
      top: 0,
      advance,
    };
  }
  const leftPx = Math.floor(shape.left * tier);
  const bottomPx = Math.floor(shape.bottom * tier);
  const rightPx = Math.ceil(shape.right * tier);
  const topPx = Math.ceil(shape.top * tier);
  const width = rightPx - leftPx + 2 * GLYPH_PADDING_PX;
  const height = topPx - bottomPx + 2 * GLYPH_PADDING_PX;
  const bitmap = font.generateMSDFWithOverlapFix(
    codepoint,
    width,
    height,
    DISTANCE_RANGE_PX,
    (GLYPH_PADDING_PX - leftPx) / tier,
    (GLYPH_PADDING_PX - bottomPx) / tier,
    tier,
  );
  const pixels = new Uint8Array(bitmap.data.size());
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = bitmap.data.get(index);
  bitmap.data.delete();
  return {
    field: 'msdf',
    width,
    height,
    pixels,
    left: leftPx - GLYPH_PADDING_PX,
    top: topPx + GLYPH_PADDING_PX,
    advance,
  };
}
