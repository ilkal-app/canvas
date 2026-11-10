import type { GlyphBitmap, GlyphField } from '../atlas/glyph-bitmap.js';
import type { GlyphKey } from '../atlas/glyph-key.js';
import type { GlyphTier } from '../atlas/glyph-tiers.js';

/**
 * A request to generate a batch of glyphs of one face at one tier, the payload of an `msdf` job
 * (MSDF generation runs in the worker pool). The font file is a job resource under `fontKey`
 * (the pool sends it to each worker once, as layout jobs' files are), or travels in the
 * request for a caller without resources; workers cache the loaded font by `fontKey`.
 */
export interface MsdfJobRequest {
  /** The face as the atlas keys it (`glyphFaceOf`: with its coordinates), echoed. */
  readonly faceId: string;
  /** Identifies the font bytes (`LoadedFontFace.fontKey`), for the worker's font cache. */
  readonly fontKey: string;
  /**
   * The font file, for a caller that does not send it as the job's resource under `fontKey`;
   * the handler reads the resource first (`fontBytesOf`).
   */
  readonly fontBytes?: ArrayBuffer;
  /** The glyphs to generate: codepoints, or shaped glyphs' ids ({@link GlyphKey}). */
  readonly keys: readonly GlyphKey[];
  /** Texels per em. */
  readonly tier: GlyphTier;
  /** `msdf` to use msdfgen when the worker has it; `sdf` forces the raster fallback. */
  readonly field: GlyphField;
  /**
   * The variable-font coordinates to draw at, normalised; absent for the defaults.
   * msdfgen reads the default instance only, so glyphs at coordinates take the raster path.
   */
  readonly variations?: Readonly<Record<string, number>>;
}

/** One generated glyph. */
export interface GeneratedGlyph {
  /** The glyph's key, as requested. */
  readonly key: GlyphKey;
  /** Its field and metrics; `bitmap.field` says whether msdfgen or the fallback made it. */
  readonly bitmap: GlyphBitmap;
}

/** A generated batch, the response of an `msdf` job; the bitmaps' buffers are transferred. */
export interface MsdfJobResponse {
  /** The face. */
  readonly faceId: string;
  /** The tier. */
  readonly tier: GlyphTier;
  /** One glyph per requested key, in request order. */
  readonly glyphs: readonly GeneratedGlyph[];
}

/** An empty file: what a request whose font file never arrived reads, which parses to no glyphs. */
const NO_FONT_BYTES = new ArrayBuffer(0);

/**
 * A request's font file: the bytes it carries, or none (an empty file, whose glyphs come out
 * empty, as an unreadable face's do).
 *
 * @param request - The request.
 * @returns The bytes.
 */
export function fontBytesOf(request: MsdfJobRequest): ArrayBuffer {
  return request.fontBytes ?? NO_FONT_BYTES;
}
