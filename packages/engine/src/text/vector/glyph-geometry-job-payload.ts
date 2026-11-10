import type { GlyphKey } from '../atlas/glyph-key.js';

import type { GlyphGeometry } from './glyph-geometry.js';

/**
 * A request for the geometry of a batch of one face's glyphs, the payload of a `glyphGeometry`
 * job: the vector glyph tier's triangles, built where HarfBuzz reads the outlines. The
 * font file travels with each request, as an `msdf` job's does, and workers cache the parsed font
 * by `fontKey`.
 */
export interface GlyphGeometryJobRequest {
  /** The face as the geometry is keyed by (`glyphFaceOf`: with its coordinates), echoed. */
  readonly faceId: string;
  /** Identifies the font bytes (`LoadedFontFace.fontKey`), for the worker's font cache. */
  readonly fontKey: string;
  /** The font file. */
  readonly fontBytes: ArrayBuffer;
  /** The glyphs: codepoints, or shaped glyphs' ids ({@link GlyphKey}). */
  readonly keys: readonly GlyphKey[];
  /** The variable-font coordinates to read the outlines at; absent for the defaults. */
  readonly variations?: Readonly<Record<string, number>>;
  /** How far a cubic's quadratics may stray from it, in em; default `DEFAULT_CUBIC_TOLERANCE_EM`. */
  readonly toleranceEm?: number;
}

/** One glyph's geometry, with its key. */
export interface GlyphGeometryJobGlyph extends GlyphGeometry {
  /** The glyph's key, as requested. */
  readonly key: GlyphKey;
}

/** A batch's geometry, the response of a `glyphGeometry` job; the vertex buffers are transferred. */
export interface GlyphGeometryJobResponse {
  /** The face. */
  readonly faceId: string;
  /** One glyph per requested key, in request order; empty for a glyph the font lacks. */
  readonly glyphs: readonly GlyphGeometryJobGlyph[];
}
