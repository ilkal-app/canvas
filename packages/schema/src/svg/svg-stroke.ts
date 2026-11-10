// Strokes of imported SVG elements: the width through the element's transform, and
// where an outline turns a corner a join would show. Dashes, joins and caps: `svg-stroke-style.ts`.
// Pure.
import type { Rgba } from '../fields/color.js';
import { MAX_STROKE_WIDTH, type Stroke } from '../fields/stroke.js';
import type { AffineMap } from '../geometry/affine-map.js';

import type { OutlinePiece, Subpath } from './svg-geometry.js';
import type { Outline } from './svg-outline.js';
import type { SvgStyle } from './svg-style.js';
import { excerpt, readLength } from './svg-values.js';
import { report, TOLERANCE, type Walk } from './svg-walk.js';
import type { SvgElement } from './svg-xml.js';

/** Everything one element needs to become objects. */
export interface Drawing {
  /** The element. */
  readonly element: SvgElement;
  /** Its outline, in its user space. */
  readonly outline: Outline;
  /** Its computed style. */
  readonly style: SvgStyle;
  /** From its user space to the group's frame. */
  readonly ctm: AffineMap;
  /** The element's opacity times its ancestors'. */
  readonly opacity: number;
}

/**
 * The scales and rotation of a map's linear part when it is a rotation of an axis-aligned
 * scale (perhaps mirrored), or undefined when it skews.
 *
 * @param map - The map.
 * @returns Its x and y scales, its rotation, and whether it mirrors.
 */
export function rigidScale(
  map: AffineMap,
): { sx: number; sy: number; rotation: number; isMirrored: boolean } | undefined {
  const sx = Math.hypot(map.a, map.b);
  const sy = Math.hypot(map.c, map.d);
  if (sx === 0 || sy === 0 || Math.abs(map.a * map.c + map.b * map.d) > TOLERANCE * sx * sy) {
    return undefined;
  }
  return {
    sx,
    sy,
    rotation: Math.atan2(map.b, map.a),
    isMirrored: map.a * map.d - map.b * map.c < 0,
  };
}

/**
 * Tells whether two scales are equal, within {@link TOLERANCE}.
 *
 * @param p - A scale.
 * @param q - Another.
 * @returns True when equal.
 */
export function sameScale(p: number, q: number): boolean {
  return Math.abs(p - q) <= TOLERANCE * Math.max(p, q);
}

/**
 * How much an element's stroke lengths (its width, its dashes) grow on the board: the square root
 * of its transform's area scale, or 1 for a non-scaling stroke.
 *
 * @param drawing - The element.
 * @returns The factor.
 */
export function strokeScaleOf(drawing: Drawing): number {
  const { ctm } = drawing;
  return drawing.style.isNonScalingStroke ? 1 : Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c));
}

/**
 * The stroke an element draws on the board: its width through the transform, capped at the
 * board's widest; problems reported.
 *
 * @param drawing - The element.
 * @param color - The stroke colour, or null.
 * @param walk - Where problems are reported.
 * @returns The stroke, or null for none.
 */
export function boardStroke(drawing: Drawing, color: Rgba | null, walk: Walk): Stroke | null {
  if (color === null) return null;
  const { style, ctm } = drawing;
  const written = readLength(style.strokeWidth);
  if (written === undefined) {
    report(walk, {
      feature: 'stroke-width',
      detail: `"${excerpt(style.strokeWidth)}" is not in user units; drawn 1 wide`,
    });
  }
  const scale = strokeScaleOf(drawing);
  const rigid = rigidScale(ctm);
  if (!style.isNonScalingStroke && (rigid === undefined || !sameScale(rigid.sx, rigid.sy))) {
    report(walk, {
      feature: 'stroke scaling',
      detail: 'a stretched or skewed stroke is drawn with one width',
    });
  }
  const width = (written ?? 1) * scale;
  if (!(width > 0)) return null;
  if (width > MAX_STROKE_WIDTH) {
    report(walk, {
      feature: 'stroke-width',
      detail: `strokes wider than ${String(MAX_STROKE_WIDTH)} are drawn ${String(MAX_STROKE_WIDTH)} wide`,
    });
  }
  return { color, width: Math.min(width, MAX_STROKE_WIDTH) };
}

/**
 * The turn, in radians, above which a join shows: a miter, bevel or round join differ visibly only
 * where the outline turns, and below about a degree the difference is under a stroke's width of a
 * pixel at any size the board draws.
 */
const CORNER_ANGLE = 0.02;

/** A direction, not normalised. */
interface Direction {
  readonly x: number;
  readonly y: number;
}

/**
 * The first of some directions that is not zero-length.
 *
 * @param directions - Candidates, in order of preference.
 * @returns The direction, or `undefined` when all are zero-length.
 */
function firstDirection(directions: readonly Direction[]): Direction | undefined {
  return directions.find(({ x, y }) => Math.hypot(x, y) > TOLERANCE);
}

/**
 * The direction a piece leaves its start in and the one it arrives at its end in.
 *
 * @param from - Where the piece starts.
 * @param piece - The piece.
 * @returns Both directions, or `undefined` for a piece of no length.
 */
function tangentsOf(
  from: Direction,
  piece: OutlinePiece,
): { readonly start: Direction; readonly end: Direction } | undefined {
  const toward = (a: Direction, b: Direction): Direction => ({ x: b.x - a.x, y: b.y - a.y });
  const start =
    piece.kind === 'line'
      ? firstDirection([toward(from, piece.to)])
      : firstDirection([toward(from, piece.c1), toward(from, piece.c2), toward(from, piece.to)]);
  const end =
    piece.kind === 'line'
      ? start
      : firstDirection([
          toward(piece.c2, piece.to),
          toward(piece.c1, piece.to),
          toward(from, piece.to),
        ]);
  return start === undefined || end === undefined ? undefined : { start, end };
}

/**
 * Whether the outline turns by more than {@link CORNER_ANGLE} going from one direction to the next.
 *
 * @param arriving - The direction the outline arrives in.
 * @param leaving - The direction it leaves in.
 * @returns True at a corner.
 */
function turnsCorner(arriving: Direction, leaving: Direction): boolean {
  const cross = arriving.x * leaving.y - arriving.y * leaving.x;
  const dot = arriving.x * leaving.x + arriving.y * leaving.y;
  return Math.atan2(Math.abs(cross), dot) > CORNER_ANGLE;
}

/**
 * Whether a subpath turns a corner a join would show: where one piece meets the next, and on a
 * closed subpath where it closes (along the closing line, if any, and back into its first piece).
 * Pieces of no length are skipped. Pure.
 *
 * @param subpath - The subpath.
 * @returns True when it has a sharp corner.
 */
export function hasSharpCorner(subpath: Subpath): boolean {
  const tangents: { readonly start: Direction; readonly end: Direction }[] = [];
  let from: Direction = subpath.start;
  for (const piece of subpath.pieces) {
    const tangent = tangentsOf(from, piece);
    if (tangent !== undefined) tangents.push(tangent);
    from = piece.to;
  }
  if (subpath.isClosed) {
    const closing = tangentsOf(from, { kind: 'line', to: subpath.start });
    if (closing !== undefined) tangents.push(closing);
    // Back into the first piece, even when it is the only one: a closed curve that returns to
    // its start at an angle has a corner there.
    const [first] = tangents;
    if (first !== undefined) tangents.push(first);
  }
  return tangents.some((tangent, index) => {
    const next = tangents[index + 1];
    return next !== undefined && turnsCorner(tangent.end, next.start);
  });
}
