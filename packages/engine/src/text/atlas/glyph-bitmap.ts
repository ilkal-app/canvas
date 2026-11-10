/**
 * The full distance range a glyph field encodes, in raster px: a texel stores
 * `0.5 + d / DISTANCE_RANGE_PX`, clamped to [0, 1], where `d` is the signed distance to the
 * outline, positive inside. The same on every tier (a fixed range keeps the 8-bit step at 1/16
 * texel; the prototype's `HALF_RANGE_PX`, `src/atlas/glyphProvider.ts`), and the same for MSDF
 * and the single-channel fallback, so one shader draws both.
 */
export const DISTANCE_RANGE_PX = 16;

/** Empty texels around every glyph bitmap, half the distance range, so the field can fall off. */
export const GLYPH_PADDING_PX = DISTANCE_RANGE_PX / 2;

/**
 * How a bitmap encodes its glyph: `msdf` has three channels (msdfgen's multi-channel field, the
 * median is the distance); `sdf` has one (the raster fallback's true distance); `colour` has four,
 * a colour glyph's premultiplied RGBA pixels, drawn as they are.
 */
export type GlyphField = 'msdf' | 'sdf' | 'colour';

/**
 * A glyph's distance field at one tier, as the generators produce it. Metrics are in raster px
 * at the tier's em size (a tier-64 glyph of a 1 em font is 64 px per em); the bitmap is padded
 * by {@link GLYPH_PADDING_PX} on every side.
 */
export interface GlyphBitmap {
  /** The encoding. */
  readonly field: GlyphField;
  /** Width, in texels; 0 for a glyph with no outline (a space). */
  readonly width: number;
  /** Height, in texels; 0 for a glyph with no outline. */
  readonly height: number;
  /** Rows top to bottom: 3 bytes (RGB) per texel for `msdf`, 1 for `sdf`, 4 for `colour`. */
  readonly pixels: Uint8Array;
  /** From the pen x to the bitmap's left edge, in raster px (usually negative). */
  readonly left: number;
  /** From the baseline up to the bitmap's top edge, in raster px. */
  readonly top: number;
  /** The advance width, in raster px. */
  readonly advance: number;
}
