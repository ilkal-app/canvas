// Turns HarfBuzz's draw operations into a glyph outline: closed contours of line,
// quadratic and cubic segments in em, y up, as the engine's rasteriser takes them.

import type { GlyphOutline, OutlineSegment } from '../font/glyph-outline.js';

/**
 * The most segments one glyph's outline may have: past it the glyph is drawn empty, so a
 * malformed or hostile face cannot exhaust memory. Real glyphs have a few hundred at most.
 */
export const MAX_OUTLINE_SEGMENTS = 65_536;

/**
 * Collects one glyph's draw operations, in font units, into an outline in em. Each segment starts
 * where the previous one ended; a contour starts at a move and is closed at the next move, a close
 * or the end, with a line back to its start when the operations leave a gap.
 */
export class OutlineBuilder {
  private readonly contours: OutlineSegment[][] = [];
  private contour: OutlineSegment[] | undefined;
  private startX = 0;
  private startY = 0;
  private x = 0;
  private y = 0;
  private segments = 0;
  private isOverLimit = false;

  /**
   * Starts an empty outline.
   *
   * @param unitsPerEm - The face's units per em: coordinates are divided by it.
   * @param maxSegments - The most segments the outline may have ({@link MAX_OUTLINE_SEGMENTS}).
   */
  constructor(
    private readonly unitsPerEm: number,
    private readonly maxSegments = MAX_OUTLINE_SEGMENTS,
  ) {}

  /**
   * Starts a contour at a point.
   *
   * @param x - Its x, font units.
   * @param y - Its y, font units, up.
   */
  moveTo(x: number, y: number): void {
    this.closePath();
    this.contour = [];
    this.startX = this.x = x;
    this.startY = this.y = y;
  }

  /**
   * A straight segment to a point.
   *
   * @param x - Its x, font units.
   * @param y - Its y, font units.
   */
  lineTo(x: number, y: number): void {
    this.add({ kind: 'line', x0: this.x, y0: this.y, x1: x, y1: y }, x, y);
  }

  /**
   * A quadratic segment to a point.
   *
   * @param cx - The control point's x, font units.
   * @param cy - The control point's y, font units.
   * @param x - The end's x.
   * @param y - The end's y.
   */
  quadraticTo(cx: number, cy: number, x: number, y: number): void {
    this.add({ kind: 'quadratic', x0: this.x, y0: this.y, cx, cy, x1: x, y1: y }, x, y);
  }

  /**
   * A cubic segment to a point.
   *
   * @param c1x - The first control point's x, font units.
   * @param c1y - The first control point's y.
   * @param c2x - The second control point's x.
   * @param c2y - The second control point's y.
   * @param x - The end's x.
   * @param y - The end's y.
   */
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.add({ kind: 'cubic', x0: this.x, y0: this.y, c1x, c1y, c2x, c2y, x1: x, y1: y }, x, y);
  }

  /** Closes the contour being drawn, with a line back to its start when it ends elsewhere. */
  closePath(): void {
    const contour = this.contour;
    if (contour === undefined) return;
    if (this.x !== this.startX || this.y !== this.startY) this.lineTo(this.startX, this.startY);
    if (contour.length > 0) this.contours.push(contour);
    this.contour = undefined;
  }

  /**
   * The outline drawn, in em; empty when it had more than the limit's segments.
   *
   * @returns The outline.
   */
  finish(): GlyphOutline {
    this.closePath();
    if (this.isOverLimit || this.unitsPerEm <= 0) return { contours: [] };
    const em = this.unitsPerEm;
    return {
      contours: this.contours.map((contour) => contour.map((segment) => scaled(segment, em))),
    };
  }

  private add(segment: OutlineSegment, x: number, y: number): void {
    if (this.contour === undefined) {
      // A drawing operation before any move starts a contour where the pen is.
      this.contour = [];
      this.startX = this.x;
      this.startY = this.y;
    }
    this.segments += 1;
    if (this.segments > this.maxSegments) this.isOverLimit = true;
    if (!this.isOverLimit) this.contour.push(segment);
    this.x = x;
    this.y = y;
  }
}

/**
 * A segment in font units scaled to em.
 *
 * @param segment - The segment.
 * @param em - Units per em.
 * @returns The segment, in em.
 */
function scaled(segment: OutlineSegment, em: number): OutlineSegment {
  switch (segment.kind) {
    case 'line':
      return {
        ...segment,
        x0: segment.x0 / em,
        y0: segment.y0 / em,
        x1: segment.x1 / em,
        y1: segment.y1 / em,
      };
    case 'quadratic':
      return {
        ...segment,
        x0: segment.x0 / em,
        y0: segment.y0 / em,
        cx: segment.cx / em,
        cy: segment.cy / em,
        x1: segment.x1 / em,
        y1: segment.y1 / em,
      };
    case 'cubic':
      return {
        ...segment,
        x0: segment.x0 / em,
        y0: segment.y0 / em,
        c1x: segment.c1x / em,
        c1y: segment.c1y / em,
        c2x: segment.c2x / em,
        c2y: segment.c2y / em,
        x1: segment.x1 / em,
        y1: segment.y1 / em,
      };
  }
}
