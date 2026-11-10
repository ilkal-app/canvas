// The PDF resources the vector writers add beyond a text's own: a JPEG embedded as
// it is, and a coloured tiling pattern.
import type { Affine } from './glyph-path-data.js';

/** A JPEG file a PDF embeds as it is, decoded by the reader (`/DCTDecode`). */
export interface JpegImage {
  /** Discriminates it from decoded samples. */
  readonly kind: 'jpeg';
  /** The file's bytes; `jpegInfo` must read a frame from them. */
  readonly bytes: Uint8Array;
}

/**
 * A coloured tiling pattern (`/PatternType 1`): one cell's content, repeated every `xStep` across
 * and `yStep` down, placed by `matrix` from pattern space to the page's default space (not the
 * current transformation, which a pattern ignores).
 */
export interface PdfTilingPattern {
  /** The cell's content-stream operators, in pattern space. */
  readonly content: string;
  /** The cell's box, `[left, bottom, right, top]` in pattern space. */
  readonly bbox: readonly [number, number, number, number];
  /** How far apart cells are across. */
  readonly xStep: number;
  /** How far apart cells are down. */
  readonly yStep: number;
  /** Pattern space to the page's default space. */
  readonly matrix: Affine;
}
