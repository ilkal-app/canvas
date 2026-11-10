/** A straight edge of a glyph outline, in em units, y up from the baseline. */
export interface LineSegment {
  /** Discriminates the segment kinds. */
  readonly kind: 'line';
  /** Start x, in em. */
  readonly x0: number;
  /** Start y, in em. */
  readonly y0: number;
  /** End x, in em. */
  readonly x1: number;
  /** End y, in em. */
  readonly y1: number;
}

/** A quadratic Bézier edge (TrueType's curve), in em units, y up from the baseline. */
export interface QuadraticSegment {
  /** Discriminates the segment kinds. */
  readonly kind: 'quadratic';
  /** Start x, in em. */
  readonly x0: number;
  /** Start y, in em. */
  readonly y0: number;
  /** Control point x, in em. */
  readonly cx: number;
  /** Control point y, in em. */
  readonly cy: number;
  /** End x, in em. */
  readonly x1: number;
  /** End y, in em. */
  readonly y1: number;
}

/**
 * A cubic Bézier edge: OpenType-CFF and CFF2 outlines, drawn through HarfBuzz.
 */
export interface CubicSegment {
  /** Discriminates the segment kinds. */
  readonly kind: 'cubic';
  /** Start x, in em. */
  readonly x0: number;
  /** Start y, in em. */
  readonly y0: number;
  /** First control point x, in em. */
  readonly c1x: number;
  /** First control point y, in em. */
  readonly c1y: number;
  /** Second control point x, in em. */
  readonly c2x: number;
  /** Second control point y, in em. */
  readonly c2y: number;
  /** End x, in em. */
  readonly x1: number;
  /** End y, in em. */
  readonly y1: number;
}

/** One edge of an outline contour. */
export type OutlineSegment = LineSegment | QuadraticSegment | CubicSegment;

/** A closed contour: segments in order, each starting where the previous one ended. */
export type OutlineContour = readonly OutlineSegment[];

/**
 * A glyph's outline, filled by the non-zero winding rule. TrueType orients outer contours
 * clockwise and holes counter-clockwise; the raster fallback relies only on the winding rule.
 */
export interface GlyphOutline {
  /** The closed contours; empty for a blank glyph such as the space. */
  readonly contours: readonly OutlineContour[];
}
