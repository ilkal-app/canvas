import type { Rgba } from '@canvas/schema';

import type { GpuVertexBufferLayout } from '../../gpu/vertex-layout.js';
import { LIGHT_PALETTE, type ColorPalette, type DeferredColor } from '../../paint/color-palette.js';

/**
 * One glyph quad: where its bitmap lands in world units and where it sits in its atlas page.
 * The bitmap includes the field padding, so the quad is larger than the ink.
 */
export interface GlyphQuad {
  /** Left edge, in world units. */
  readonly x: number;
  /** Top edge, in world units (y down). */
  readonly y: number;
  /** Width, in world units. */
  readonly width: number;
  /** Height, in world units. */
  readonly height: number;
  /** Left edge in the page, as a fraction of its width. */
  readonly u0: number;
  /** Top edge in the page, as a fraction of its height. */
  readonly v0: number;
  /** Right edge in the page. */
  readonly u1: number;
  /** Bottom edge in the page. */
  readonly v1: number;
  /**
   * The glyph colour, straight alpha, each channel in [0, 1]; or `'ink'` or a colour token
   * reference, resolved in the object's palette when the record is written (`glyphColorOf`).
   */
  readonly color: DeferredColor;
  /** A factor on a deferred colour's alpha (greek bars' faded ink or token); default 1. */
  readonly inkAlpha?: number;
}

/**
 * The colour a glyph quad draws with: its tuple, or for `'ink'` or a token its value in the
 * palette with the quad's `inkAlpha` applied. Allocates only for a faded deferred colour.
 *
 * @param quad - The quad.
 * @param palette - What ink and tokens draw as. Default the light theme's built-ins.
 * @returns The straight-alpha colour.
 */
export function glyphColorOf(quad: GlyphQuad, palette: ColorPalette = LIGHT_PALETTE): Rgba {
  if (Array.isArray(quad.color)) return quad.color;
  const color = palette.resolve(quad.color);
  const alpha = quad.inkAlpha ?? 1;
  return alpha === 1 ? color : [color[0], color[1], color[2], color[3] * alpha];
}

/**
 * The per-vertex buffer of the text pass: the six corners of a unit quad (two triangles),
 * `float32x2` at `@location(0)`.
 */
export const GLYPH_QUAD_VERTEX_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'vertex',
  attributes: [{ location: 0, format: 'float32x2' }],
};

/** The corners of the unit quad, as `GLYPH_QUAD_VERTEX_LAYOUT` records. */
export const GLYPH_QUAD_CORNERS: Float32Array<ArrayBuffer> = Float32Array.from([
  0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1,
]);

/** Vertices drawn per glyph instance. */
export const GLYPH_QUAD_VERTEX_COUNT = 6;

/**
 * The per-instance buffer of the text pass, one record per glyph: its rectangle in world units
 * (`float32x4`), its page rectangle (`float32x4`) and its colour (`unorm8x4`), 36 bytes.
 */
export const GLYPH_INSTANCE_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'instance',
  attributes: [
    { location: 1, format: 'float32x4' },
    { location: 2, format: 'float32x4' },
    { location: 3, format: 'unorm8x4' },
  ],
};

/** Bytes per glyph instance record. */
export const GLYPH_INSTANCE_BYTES = 36;

/**
 * Writes one glyph quad as an instance record. The colour is written byte by byte, so the
 * record is the same on every host byte order.
 *
 * @param target - The instance bytes.
 * @param index - The record to write.
 * @param quad - The glyph quad.
 */
export function writeGlyphInstance(target: DataView, index: number, quad: GlyphQuad): void {
  const offset = index * GLYPH_INSTANCE_BYTES;
  const floats = [quad.x, quad.y, quad.width, quad.height, quad.u0, quad.v0, quad.u1, quad.v1];
  floats.forEach((value, field) => {
    target.setFloat32(offset + field * 4, value, true);
  });
  glyphColorOf(quad).forEach((channel, byte) => {
    target.setUint8(offset + 32 + byte, Math.round(Math.min(1, Math.max(0, channel)) * 255));
  });
}
