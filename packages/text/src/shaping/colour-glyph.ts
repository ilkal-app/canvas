// Colour glyphs: what HarfBuzz paints for a COLRv0/v1 glyph or a bitmap strike, recorded
// as plain data. Coordinates are in em, y up, as glyph outlines are; the engine replays the ops
// into a 2D canvas at the size the glyph is drawn.

import type { GlyphOutline } from '../font/glyph-outline.js';

import type { ShapingFace } from './shaper.js';

/** A colour, each channel 0..1, unpremultiplied. */
export interface ColourGlyphRgba {
  /** Red. */
  readonly r: number;
  /** Green. */
  readonly g: number;
  /** Blue. */
  readonly b: number;
  /** Alpha. */
  readonly a: number;
}

/** One stop of a gradient's colour line. */
export interface ColourGlyphStop {
  /** Where along the gradient, 0 at its start and 1 at its end; may lie outside. */
  readonly offset: number;
  /** The colour there; the foreground colour for a foreground stop. */
  readonly color: ColourGlyphRgba;
  /** Whether the stop takes the text's foreground colour. */
  readonly isForeground: boolean;
}

/** How a gradient continues past its colour line's ends. */
export type ColourGlyphExtend = 'pad' | 'repeat' | 'reflect';

/** The COLRv1 composite modes, in the font format's order. */
export const COLOUR_GLYPH_COMPOSITES = [
  'clear',
  'src',
  'dest',
  'src-over',
  'dest-over',
  'src-in',
  'dest-in',
  'src-out',
  'dest-out',
  'src-atop',
  'dest-atop',
  'xor',
  'plus',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'multiply',
  'hsl-hue',
  'hsl-saturation',
  'hsl-color',
  'hsl-luminosity',
] as const;

/** How a group composites onto what is under it. */
export type ColourGlyphComposite = (typeof COLOUR_GLYPH_COMPOSITES)[number];

/** Multiplies later coordinates by a 2×3 affine matrix, until the matching pop. */
export interface ColourGlyphPushTransform {
  /** Discriminates the operations. */
  readonly op: 'push-transform';
  /** The matrix's x scale: x' = xx·x + xy·y + dx. */
  readonly xx: number;
  /** The matrix's y shear from x: y' = yx·x + yy·y + dy. */
  readonly yx: number;
  /** The matrix's x shear from y. */
  readonly xy: number;
  /** The matrix's y scale. */
  readonly yy: number;
  /** The x translation, in em. */
  readonly dx: number;
  /** The y translation, in em. */
  readonly dy: number;
}

/** Ends the innermost transform. */
export interface ColourGlyphPopTransform {
  /** Discriminates the operations. */
  readonly op: 'pop-transform';
}

/** Clips later paints to a glyph's outline (non-zero), until the matching pop-clip. */
export interface ColourGlyphPushClipGlyph {
  /** Discriminates the operations. */
  readonly op: 'push-clip-glyph';
  /** The clipping glyph's outline, in em, y up. */
  readonly outline: GlyphOutline;
}

/** Clips later paints to a rectangle, until the matching pop-clip. */
export interface ColourGlyphPushClipRect {
  /** Discriminates the operations. */
  readonly op: 'push-clip-rect';
  /** The left edge, in em. */
  readonly xMin: number;
  /** The bottom edge, in em. */
  readonly yMin: number;
  /** The right edge, in em. */
  readonly xMax: number;
  /** The top edge, in em. */
  readonly yMax: number;
}

/** Ends the innermost clip. */
export interface ColourGlyphPopClip {
  /** Discriminates the operations. */
  readonly op: 'pop-clip';
}

/** Fills the current clip with one colour. */
export interface ColourGlyphSolid {
  /** Discriminates the operations. */
  readonly op: 'solid';
  /** The colour; the foreground colour for a foreground paint. */
  readonly color: ColourGlyphRgba;
  /** Whether the paint takes the text's foreground colour. */
  readonly isForeground: boolean;
}

/** Fills the current clip with a COLRv1 linear gradient: p0 to p1, rotated by p2. */
export interface ColourGlyphLinear {
  /** Discriminates the operations. */
  readonly op: 'linear';
  /** The start point's x, in em. */
  readonly x0: number;
  /** The start point's y, in em. */
  readonly y0: number;
  /** The end point's x, in em. */
  readonly x1: number;
  /** The end point's y, in em. */
  readonly y1: number;
  /** The rotation point's x, in em (COLRv1's p2). */
  readonly x2: number;
  /** The rotation point's y, in em. */
  readonly y2: number;
  /** How the colour line continues past its ends. */
  readonly extend: ColourGlyphExtend;
  /** The colour line's stops, in offset order. */
  readonly stops: readonly ColourGlyphStop[];
}

/** Fills the current clip with a two-circle radial gradient. */
export interface ColourGlyphRadial {
  /** Discriminates the operations. */
  readonly op: 'radial';
  /** The start circle's centre x, in em. */
  readonly x0: number;
  /** The start circle's centre y, in em. */
  readonly y0: number;
  /** The start circle's radius, in em. */
  readonly r0: number;
  /** The end circle's centre x, in em. */
  readonly x1: number;
  /** The end circle's centre y, in em. */
  readonly y1: number;
  /** The end circle's radius, in em. */
  readonly r1: number;
  /** How the colour line continues past its ends. */
  readonly extend: ColourGlyphExtend;
  /** The colour line's stops, in offset order. */
  readonly stops: readonly ColourGlyphStop[];
}

/** Fills the current clip with a sweep (conic) gradient about a centre. */
export interface ColourGlyphSweep {
  /** Discriminates the operations. */
  readonly op: 'sweep';
  /** The centre's x, in em. */
  readonly x0: number;
  /** The centre's y, in em. */
  readonly y0: number;
  /** Where the colour line starts, in radians as HarfBuzz gives it. */
  readonly startAngle: number;
  /** Where the colour line ends, in radians. */
  readonly endAngle: number;
  /** How the colour line continues past its ends. */
  readonly extend: ColourGlyphExtend;
  /** The colour line's stops, in offset order. */
  readonly stops: readonly ColourGlyphStop[];
}

/** Draws a bitmap strike (sbix, CBDT) into a box. */
export interface ColourGlyphImage {
  /** Discriminates the operations. */
  readonly op: 'image';
  /** The bytes' format: a PNG file, or raw BGRA pixels. */
  readonly format: 'png' | 'bgra';
  /** The image's bytes. */
  readonly bytes: Uint8Array;
  /** Its width in pixels. */
  readonly width: number;
  /** Its height in pixels. */
  readonly height: number;
  /** The box's left edge, in em. */
  readonly xMin: number;
  /** The box's bottom edge, in em. */
  readonly yMin: number;
  /** The box's right edge, in em. */
  readonly xMax: number;
  /** The box's top edge, in em. */
  readonly yMax: number;
}

/** Starts a group: later paints draw into it until the matching pop-group. */
export interface ColourGlyphPushGroup {
  /** Discriminates the operations. */
  readonly op: 'push-group';
}

/** Ends the innermost group, compositing it onto what is under it. */
export interface ColourGlyphPopGroup {
  /** Discriminates the operations. */
  readonly op: 'pop-group';
  /** How the group composites. */
  readonly mode: ColourGlyphComposite;
}

/** One paint operation of a colour glyph; coordinates in em, y up. */
export type ColourGlyphOp =
  | ColourGlyphPushTransform
  | ColourGlyphPopTransform
  | ColourGlyphPushClipGlyph
  | ColourGlyphPushClipRect
  | ColourGlyphPopClip
  | ColourGlyphSolid
  | ColourGlyphLinear
  | ColourGlyphRadial
  | ColourGlyphSweep
  | ColourGlyphImage
  | ColourGlyphPushGroup
  | ColourGlyphPopGroup;

/** A colour glyph as plain, structured-cloneable data: its paint operations in order. */
export interface ColourGlyphProgram {
  /** The operations, pushes and pops balanced. */
  readonly ops: readonly ColourGlyphOp[];
}

/** How a colour glyph is painted. */
export interface ColourGlyphOptions {
  /** The font's colour palette to use; default 0. */
  readonly palette?: number;
  /** The text's colour, for foreground paints; default opaque black. */
  readonly foreground?: ColourGlyphRgba;
}

/** What a shaper reads of colour fonts. */
export interface ColourGlyphSource {
  /**
   * Whether a face has colour glyphs: COLR paint or layers, or bitmap strikes.
   *
   * @param face - A face of this shaper.
   * @returns True for a colour font.
   * @throws {RangeError} When the face is not this shaper's.
   */
  hasColourGlyphs(face: ShapingFace): boolean;
  /**
   * A glyph's colour paint, as HarfBuzz paints it (COLRv0 layers, the COLRv1 paint graph with a
   * referenced colour glyph expanded in place, or a PNG or BGRA bitmap strike). SVG glyphs are not
   * supported.
   *
   * @param face - A face of this shaper.
   * @param glyphId - The glyph's id in the font.
   * @param options - The palette and the foreground colour.
   * @returns The paint operations; undefined for a glyph with no colour or an unknown id.
   * @throws {RangeError} When the face is not this shaper's.
   */
  colourGlyph(
    face: ShapingFace,
    glyphId: number,
    options?: ColourGlyphOptions,
  ): ColourGlyphProgram | undefined;
}
