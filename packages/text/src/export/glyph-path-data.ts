// Glyph outlines as vector path data: SVG `d` strings and PDF path operators, the same
// outlines the engine's vector tier draws, placed by an affine transform. Pure.
import type { GlyphOutline, OutlineSegment } from '../font/glyph-outline.js';
import type { LayoutGlyph } from '../layout/text-layout.js';

/** A 2×3 affine transform: (x, y) maps to (a·x + c·y + e, b·x + d·y + f). */
export interface Affine {
  /** The x scale. */
  readonly a: number;
  /** The y shear from x. */
  readonly b: number;
  /** The x shear from y. */
  readonly c: number;
  /** The y scale. */
  readonly d: number;
  /** The x translation. */
  readonly e: number;
  /** The y translation. */
  readonly f: number;
}

/** The transform that changes nothing. */
export const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * The transform applying `inner` first, then `outer`.
 *
 * @param outer - The transform applied last.
 * @param inner - The transform applied first.
 * @returns Their composition.
 */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/**
 * A number as exported vectors write it: at most three decimals, never `-0`.
 *
 * @param value - The number.
 * @returns Its text.
 */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * Transforms a point and writes it as two numbers.
 *
 * @param transform - The transform.
 * @param x - The x, in em.
 * @param y - The y, in em.
 * @returns The point's text, `x y`.
 */
function point(transform: Affine, x: number, y: number): string {
  const { a, b, c, d, e, f } = transform;
  return `${formatNumber(a * x + c * y + e)} ${formatNumber(b * x + d * y + f)}`;
}

/**
 * The cubic control points of a quadratic, raised exactly: q0 + 2/3·(q1 − q0) and
 * q2 + 2/3·(q1 − q2).
 *
 * @param segment - The quadratic.
 * @returns The two cubic control points.
 */
function raisedControls(segment: Extract<OutlineSegment, { kind: 'quadratic' }>): number[] {
  const { x0, y0, cx, cy, x1, y1 } = segment;
  return [
    x0 + (2 / 3) * (cx - x0),
    y0 + (2 / 3) * (cy - y0),
    x1 + (2 / 3) * (cx - x1),
    y1 + (2 / 3) * (cy - y1),
  ];
}

/**
 * A glyph outline as an SVG path's `d`: absolute M, L, Q, C and Z per contour, transformed.
 * Contours are closed and filled non-zero, as the outline is.
 *
 * @param outline - The outline, in em, y up.
 * @param transform - Where it goes, e.g. {@link glyphTransform}.
 * @returns The path data; `''` for an empty outline.
 */
export function glyphPathData(outline: GlyphOutline, transform: Affine): string {
  const parts: string[] = [];
  for (const contour of outline.contours) {
    const [first] = contour;
    if (first === undefined) continue;
    parts.push(`M ${point(transform, first.x0, first.y0)}`);
    for (const segment of contour) {
      const end = point(transform, segment.x1, segment.y1);
      if (segment.kind === 'line') parts.push(`L ${end}`);
      else if (segment.kind === 'quadratic')
        parts.push(`Q ${point(transform, segment.cx, segment.cy)} ${end}`);
      else
        parts.push(
          `C ${point(transform, segment.c1x, segment.c1y)} ${point(transform, segment.c2x, segment.c2y)} ${end}`,
        );
    }
    parts.push('Z');
  }
  return parts.join(' ');
}

/**
 * A glyph outline as PDF path operators (`m`, `l`, `c`, `h`), transformed; a quadratic is raised
 * to the cubic that draws it exactly, as PDF has no quadratics.
 *
 * @param outline - The outline, in em, y up.
 * @param transform - Where it goes.
 * @returns The operators; `''` for an empty outline.
 */
export function glyphPdfPath(outline: GlyphOutline, transform: Affine): string {
  const parts: string[] = [];
  for (const contour of outline.contours) {
    const [first] = contour;
    if (first === undefined) continue;
    parts.push(`${point(transform, first.x0, first.y0)} m`);
    for (const segment of contour) {
      const end = point(transform, segment.x1, segment.y1);
      if (segment.kind === 'line') {
        parts.push(`${end} l`);
        continue;
      }
      const [c1x = 0, c1y = 0, c2x = 0, c2y = 0] =
        segment.kind === 'quadratic'
          ? raisedControls(segment)
          : [segment.c1x, segment.c1y, segment.c2x, segment.c2y];
      parts.push(`${point(transform, c1x, c1y)} ${point(transform, c2x, c2y)} ${end} c`);
    }
    parts.push('h');
  }
  return parts.join(' ');
}

/**
 * Where a laid-out glyph's outline goes in its text box: its em, y-up outline scaled by the font
 * size and flipped into the box's y-down frame at the glyph's pen position and baseline.
 *
 * @param glyph - The glyph, as the layout placed it.
 * @param fontSize - Its run's font size, in box units; outlines are already in em.
 * @returns `translate(glyph.x, glyph.y) · scale(fontSize, −fontSize)`.
 */
export function glyphTransform(glyph: LayoutGlyph, fontSize: number): Affine {
  return { a: fontSize, b: 0, c: 0, d: -fontSize, e: glyph.x, f: glyph.y };
}
