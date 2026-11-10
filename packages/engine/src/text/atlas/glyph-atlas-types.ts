import type { GpuTextureFormat } from '../../gpu/gpu-texture.js';

import type { GlyphField } from './glyph-bitmap.js';
import type { GlyphTier } from './glyph-tiers.js';

// The glyph atlas's public shapes, apart from the atlas so it stays under the line limit.

/** Where a glyph sits in the atlas and how to place its quad. */
export interface AtlasGlyph {
  /** The page holding it; `undefined` for a blank glyph, which draws nothing. */
  readonly pageId: number | undefined;
  /** How its texels encode distance. */
  readonly field: GlyphField;
  /** Left edge of the bitmap, as a fraction of the page width. */
  readonly u0: number;
  /** Top edge of the bitmap, as a fraction of the page height. */
  readonly v0: number;
  /** Right edge of the bitmap. */
  readonly u1: number;
  /** Bottom edge of the bitmap. */
  readonly v1: number;
  /** Bitmap width, in texels (raster px at the tier). */
  readonly width: number;
  /** Bitmap height, in texels. */
  readonly height: number;
  /** From the pen x to the bitmap's left edge, in raster px. */
  readonly left: number;
  /** From the baseline up to the bitmap's top edge, in raster px. */
  readonly top: number;
  /** The advance, in raster px. */
  readonly advance: number;
  /** The tier the bitmap was generated at: raster px per em. */
  readonly tier: GlyphTier;
}

/** An atlas page: one square texture holding glyphs of one kind. */
export interface AtlasPage {
  /** Stable id; ids of released pages are not reused. */
  readonly id: number;
  /** The kind of glyph it holds; MSDF and colour glyphs never share a page. */
  readonly field: GlyphField;
  /** `rgba8unorm` for MSDF and colour glyphs, `r8unorm` for single-channel fallback glyphs. */
  readonly format: GpuTextureFormat;
  /** Width and height, in texels. */
  readonly size: number;
}

/** The atlas's GPU memory, reported under the "glyph atlas pages" memory category. */
export interface AtlasMemoryReport {
  /** The memory category. */
  readonly category: 'glyph-atlas';
  /** Bytes of every page texture the atlas holds. */
  readonly residentBytes: number;
  /** The most the pages may take. */
  readonly budgetBytes: number;
  /** Pages held. */
  readonly pageCount: number;
  /** Glyphs with texels held. */
  readonly glyphCount: number;
  /** Glyphs evicted since the atlas was created. */
  readonly evictedGlyphCount: number;
  /**
   * Glyphs inserted again within `REGENERATION_WINDOW_MS` of their eviction, since the atlas was
   * created: thrash, which a zoom sweep must not cause.
   */
  readonly regeneratedGlyphCount: number;
  /** Glyphs turned away because nothing evictable made room. */
  readonly rejectedGlyphCount: number;
}
