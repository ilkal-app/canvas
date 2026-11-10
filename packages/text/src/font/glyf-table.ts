import { FontFormatError } from './font-format-error.js';
import type { GlyphOutline, OutlineContour, OutlineSegment } from './glyph-outline.js';
import type { SfntFile } from './sfnt-file.js';

/** Simple-glyph point flags (OpenType `glyf`). */
const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;

/** Composite-glyph component flags. */
const ARGS_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const HAS_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const HAS_XY_SCALE = 0x0040;
const HAS_TWO_BY_TWO = 0x0080;

/** Components nest at most this deep; deeper (or cyclic) composites are treated as corrupt. */
const MAX_COMPONENT_DEPTH = 8;
/**
 * One outline holds at most this many points, and visits at most this many glyphs, however its
 * components fan out: within the depth limit a composite of composites could otherwise
 * multiply into billions. Real glyphs stay far below both.
 */
const MAX_OUTLINE_POINTS = 65_536;
const MAX_COMPONENT_VISITS = 4_096;

/** What an outline has used of its budget so far. */
interface OutlineBudget {
  points: number;
  visits: number;
}

/** A point of a simple glyph, in font units. */
interface OutlinePoint {
  readonly x: number;
  readonly y: number;
  readonly isOnCurve: boolean;
}

/** A 2×2 transform plus offset, applied to a component's points (font units). */
interface Transform {
  readonly xx: number;
  readonly xy: number;
  readonly yx: number;
  readonly yy: number;
  readonly dx: number;
  readonly dy: number;
}

const IDENTITY: Transform = { xx: 1, xy: 0, yx: 0, yy: 1, dx: 0, dy: 0 };

/**
 * Decodes TrueType outlines from the `glyf` and `loca` tables into contours of line and
 * quadratic segments in em units. CFF-flavoured fonts (`.otf` with a `CFF ` table) have no
 * `glyf` table and are not decoded here; msdfgen reads them.
 */
export class GlyfTable {
  private readonly glyf: DataView;
  private readonly loca: DataView;

  /**
   * Opens the tables.
   *
   * @param file - The font file.
   * @param indexToLocFormat - `head.indexToLocFormat`: 0 for 16-bit offsets, 1 for 32-bit.
   * @param unitsPerEm - Font units per em, to convert coordinates.
   * @param glyphCount - Glyphs in the font.
   * @throws {FontFormatError} When `glyf` or `loca` is missing.
   */
  constructor(
    file: SfntFile,
    private readonly indexToLocFormat: number,
    private readonly unitsPerEm: number,
    private readonly glyphCount: number,
  ) {
    this.glyf = file.table('glyf');
    this.loca = file.table('loca');
  }

  /**
   * Decodes one glyph's outline.
   *
   * @param glyphId - The glyph.
   * @returns Its contours in em units; none for a blank or out-of-range glyph.
   * @throws {FontFormatError} When the glyph data is corrupt.
   */
  outline(glyphId: number): GlyphOutline {
    const points: OutlinePoint[][] = [];
    this.collect(glyphId, IDENTITY, 0, points, { points: 0, visits: 0 });
    return { contours: points.map((contour) => this.toSegments(contour)) };
  }

  private glyphRange(glyphId: number): { start: number; end: number } {
    if (glyphId < 0 || glyphId >= this.glyphCount) return { start: 0, end: 0 };
    if (this.indexToLocFormat === 0) {
      return {
        start: this.loca.getUint16(glyphId * 2) * 2,
        end: this.loca.getUint16(glyphId * 2 + 2) * 2,
      };
    }
    return { start: this.loca.getUint32(glyphId * 4), end: this.loca.getUint32(glyphId * 4 + 4) };
  }

  private collect(
    glyphId: number,
    transform: Transform,
    depth: number,
    into: OutlinePoint[][],
    budget: OutlineBudget,
  ): void {
    if (depth > MAX_COMPONENT_DEPTH) {
      throw new FontFormatError(`Glyph ${String(glyphId)} nests components too deeply.`);
    }
    budget.visits += 1;
    if (budget.visits > MAX_COMPONENT_VISITS) {
      throw new FontFormatError(`Glyph ${String(glyphId)} has too many components.`);
    }
    const { start, end } = this.glyphRange(glyphId);
    if (end <= start) return;
    const contourCount = this.glyf.getInt16(start);
    if (contourCount >= 0) {
      for (const contour of this.readSimple(start, contourCount, glyphId, budget)) {
        into.push(contour.map((point) => applyTransform(point, transform)));
      }
    } else {
      this.readComposite(start + 10, transform, depth, into, budget);
    }
  }

  private readSimple(
    start: number,
    contourCount: number,
    glyphId: number,
    budget: OutlineBudget,
  ): OutlinePoint[][] {
    const glyf = this.glyf;
    const endPoints: number[] = [];
    for (let contour = 0; contour < contourCount; contour += 1) {
      const end = glyf.getUint16(start + 10 + contour * 2);
      // Contours end in increasing order (OpenType `glyf`); out of order, they would read their
      // points again and again.
      if (end <= (endPoints.at(-1) ?? -1)) {
        throw new FontFormatError(`Glyph ${String(glyphId)} ends its contours out of order.`);
      }
      endPoints.push(end);
    }
    const pointCount = (endPoints.at(-1) ?? -1) + 1;
    // The budget is checked before a point is decoded, so a glyph past it allocates nothing.
    budget.points += pointCount;
    if (budget.points > MAX_OUTLINE_POINTS) {
      throw new FontFormatError(`Glyph ${String(glyphId)} has too many points.`);
    }
    const instructionLength = glyf.getUint16(start + 10 + contourCount * 2);
    let offset = start + 12 + contourCount * 2 + instructionLength;
    const flags: number[] = [];
    while (flags.length < pointCount) {
      const flag = glyf.getUint8(offset);
      offset += 1;
      flags.push(flag);
      if ((flag & REPEAT) !== 0) {
        const repeatCount = glyf.getUint8(offset);
        offset += 1;
        for (let repeat = 0; repeat < repeatCount; repeat += 1) flags.push(flag);
      }
    }
    const xs = readCoordinates(glyf, offset, flags, pointCount, X_SHORT, X_SAME_OR_POSITIVE);
    const ys = readCoordinates(glyf, xs.end, flags, pointCount, Y_SHORT, Y_SAME_OR_POSITIVE);
    const contours: OutlinePoint[][] = [];
    let first = 0;
    for (const last of endPoints) {
      const contour: OutlinePoint[] = [];
      for (let point = first; point <= last; point += 1) {
        const isOnCurve = ((flags[point] ?? 0) & ON_CURVE) !== 0;
        contour.push({ x: xs.values[point] ?? 0, y: ys.values[point] ?? 0, isOnCurve });
      }
      contours.push(contour);
      first = last + 1;
    }
    return contours;
  }

  private readComposite(
    offset: number,
    parent: Transform,
    depth: number,
    into: OutlinePoint[][],
    budget: OutlineBudget,
  ): void {
    const glyf = this.glyf;
    let flags = MORE_COMPONENTS;
    let cursor = offset;
    while ((flags & MORE_COMPONENTS) !== 0) {
      flags = glyf.getUint16(cursor);
      const componentId = glyf.getUint16(cursor + 2);
      cursor += 4;
      const isWords = (flags & ARGS_ARE_WORDS) !== 0;
      const argument1 = isWords ? glyf.getInt16(cursor) : glyf.getInt8(cursor);
      const argument2 = isWords ? glyf.getInt16(cursor + 2) : glyf.getInt8(cursor + 1);
      cursor += isWords ? 4 : 2;
      // Point-matching placement (args are point indices) is rare in Latin fonts; such a
      // component is placed without an offset.
      const hasOffset = (flags & ARGS_ARE_XY_VALUES) !== 0;
      const scale = readComponentScale(glyf, cursor, flags);
      cursor = scale.end;
      const local: Transform = {
        ...scale.transform,
        dx: hasOffset ? argument1 : 0,
        dy: hasOffset ? argument2 : 0,
      };
      this.collect(componentId, compose(parent, local), depth + 1, into, budget);
    }
  }

  private toSegments(points: readonly OutlinePoint[]): OutlineContour {
    return contourSegments(points, 1 / this.unitsPerEm);
  }
}

function readCoordinates(
  glyf: DataView,
  offset: number,
  flags: readonly number[],
  pointCount: number,
  shortFlag: number,
  sameOrPositiveFlag: number,
): { values: number[]; end: number } {
  const values: number[] = [];
  let value = 0;
  let cursor = offset;
  for (let point = 0; point < pointCount; point += 1) {
    const flag = flags[point] ?? 0;
    if ((flag & shortFlag) !== 0) {
      const delta = glyf.getUint8(cursor);
      cursor += 1;
      value += (flag & sameOrPositiveFlag) !== 0 ? delta : -delta;
    } else if ((flag & sameOrPositiveFlag) === 0) {
      value += glyf.getInt16(cursor);
      cursor += 2;
    }
    values.push(value);
  }
  return { values, end: cursor };
}

/**
 * Reads a component's scale, stored as F2DOT14 (signed 2.14 fixed-point) numbers.
 *
 * @param glyf - The `glyf` table.
 * @param offset - Where the scale fields start.
 * @param flags - The component's flags, which say which scale fields are present.
 * @returns The scale as a transform, and the offset after it.
 */
function readComponentScale(
  glyf: DataView,
  offset: number,
  flags: number,
): { transform: Transform; end: number } {
  const f2dot14 = (at: number): number => glyf.getInt16(at) / 0x4000;
  if ((flags & HAS_SCALE) !== 0) {
    const scale = f2dot14(offset);
    return { transform: { ...IDENTITY, xx: scale, yy: scale }, end: offset + 2 };
  }
  if ((flags & HAS_XY_SCALE) !== 0) {
    return {
      transform: { ...IDENTITY, xx: f2dot14(offset), yy: f2dot14(offset + 2) },
      end: offset + 4,
    };
  }
  if ((flags & HAS_TWO_BY_TWO) !== 0) {
    const transform = {
      xx: f2dot14(offset),
      xy: f2dot14(offset + 2),
      yx: f2dot14(offset + 4),
      yy: f2dot14(offset + 6),
      dx: 0,
      dy: 0,
    };
    return { transform, end: offset + 8 };
  }
  return { transform: IDENTITY, end: offset };
}

function applyTransform(point: OutlinePoint, transform: Transform): OutlinePoint {
  return {
    x: point.x * transform.xx + point.y * transform.yx + transform.dx,
    y: point.x * transform.xy + point.y * transform.yy + transform.dy,
    isOnCurve: point.isOnCurve,
  };
}

/**
 * Composes two transforms.
 *
 * @param parent - Applied second.
 * @param local - Applied first.
 * @returns The combined transform.
 */
function compose(parent: Transform, local: Transform): Transform {
  const origin = applyTransform({ x: local.dx, y: local.dy, isOnCurve: true }, parent);
  return {
    xx: local.xx * parent.xx + local.xy * parent.yx,
    xy: local.xx * parent.xy + local.xy * parent.yy,
    yx: local.yx * parent.xx + local.yy * parent.yx,
    yy: local.yx * parent.xy + local.yy * parent.yy,
    dx: origin.x,
    dy: origin.y,
  };
}

/**
 * Turns a TrueType contour into segments. Two off-curve points in a row imply an on-curve point
 * midway between them; a contour of only off-curve points starts at the implied point between
 * its first two.
 *
 * @param points - The contour's points, in font units.
 * @param scale - Em per font unit.
 * @returns The contour's segments in em, degenerate ones dropped.
 */
function contourSegments(points: readonly OutlinePoint[], scale: number): OutlineContour {
  const count = points.length;
  const at = (index: number): OutlinePoint =>
    points[index % count] ?? { x: 0, y: 0, isOnCurve: true };
  if (count === 0) return [];
  const firstOnCurve = points.findIndex((point) => point.isOnCurve);
  const start = firstOnCurve >= 0 ? at(firstOnCurve) : midpoint(at(0), at(1));
  // Every point once after the start, then the start again to close the contour.
  const walk: OutlinePoint[] = [];
  const first = firstOnCurve >= 0 ? firstOnCurve + 1 : 1;
  const walkLength = firstOnCurve >= 0 ? count - 1 : count;
  for (let step = 0; step < walkLength; step += 1) walk.push(at(first + step));
  const segments: OutlineSegment[] = [];
  let current = start;
  let control: OutlinePoint | undefined;
  for (const point of [...walk, start]) {
    if (point.isOnCurve) {
      segments.push(segment(current, control, point, scale));
      current = point;
      control = undefined;
    } else if (control === undefined) {
      control = point;
    } else {
      const implied = midpoint(control, point);
      segments.push(segment(current, control, implied, scale));
      current = implied;
      control = point;
    }
  }
  return segments.filter((candidate) => !isDegenerate(candidate));
}

function midpoint(a: OutlinePoint, b: OutlinePoint): OutlinePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, isOnCurve: true };
}

function segment(
  from: OutlinePoint,
  control: OutlinePoint | undefined,
  to: OutlinePoint,
  scale: number,
): OutlineSegment {
  const [x0, y0, x1, y1] = [from.x * scale, from.y * scale, to.x * scale, to.y * scale];
  if (control === undefined) return { kind: 'line', x0, y0, x1, y1 };
  return { kind: 'quadratic', x0, y0, cx: control.x * scale, cy: control.y * scale, x1, y1 };
}

function isDegenerate(candidate: OutlineSegment): boolean {
  return (
    candidate.kind === 'line' && candidate.x0 === candidate.x1 && candidate.y0 === candidate.y1
  );
}
