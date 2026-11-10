import { strokeStyleReason } from '../drawable/stroke-style-values.js';
import {
  DEFAULT_STROKE_MITER_LIMIT,
  type StrokeCap,
  type StrokeJoin,
  type StrokeStyle,
} from '../fields/stroke-style.js';

/** A dash pattern as the mesh builder reads it: lengths and a start offset, world units. */
export interface DashPattern {
  /** Dash and gap lengths, alternating, dash first; an odd count repeats (as SVG). */
  readonly pattern: readonly number[];
  /** How far into the pattern the stroke starts, world units. */
  readonly offset: number;
}

/**
 * How a path's, line's or connector's stroke is drawn beyond its width: plain data, so a
 * `mesh` job carries it to a worker. Absent members keep the drawing of earlier builds.
 */
export interface StrokeOutline {
  /** The join at corners; absent for the round join every earlier build drew. */
  readonly join?: StrokeJoin;
  /** The miter limit of miter joins, at least 1; absent for 4. */
  readonly miterLimit?: number;
  /** The dash pattern; absent for a solid stroke. */
  readonly dash?: DashPattern;
  /** The cap of open ends without a decoration, and of every dash end; absent for round. */
  readonly cap?: StrokeCap;
}

/** The outline of a stroke with no style: drawn as every earlier build drew it. */
export const PLAIN_OUTLINE: StrokeOutline = Object.freeze({});

/**
 * Whether one stroke style field is one the door accepts, judged alone.
 *
 * @param field - The field's name.
 * @param value - Its stored value.
 * @returns True when the value is absent or acceptable.
 */
function isReadable(field: keyof StrokeStyle, value: unknown): boolean {
  return value === undefined || strokeStyleReason({ [field]: value }) === undefined;
}

/**
 * The outline an object's stroke style asks for. The reader is tolerant:
 * a field the schema refuses, which a peer that skipped the door could store, is read as
 * absent, so the stroke still draws. Pure.
 *
 * @param style - The object's stroke style fields, as stored; not mutated.
 * @returns The outline; {@link PLAIN_OUTLINE} when no field is set.
 */
export function strokeOutlineOf(style: StrokeStyle): StrokeOutline {
  const { strokeDash, strokeJoin, strokeMiterLimit, strokeCap } = style;
  const outline: {
    join?: StrokeJoin;
    miterLimit?: number;
    dash?: DashPattern;
    cap?: StrokeCap;
  } = {};
  if (strokeJoin !== undefined && isReadable('strokeJoin', strokeJoin)) outline.join = strokeJoin;
  if (strokeMiterLimit !== undefined && isReadable('strokeMiterLimit', strokeMiterLimit)) {
    outline.miterLimit = strokeMiterLimit;
  }
  if (strokeCap !== undefined && isReadable('strokeCap', strokeCap)) outline.cap = strokeCap;
  if (strokeDash !== undefined && strokeDash !== null && isReadable('strokeDash', strokeDash)) {
    outline.dash = { pattern: [...strokeDash.pattern], offset: strokeDash.offset ?? 0 };
  }
  return Object.keys(outline).length === 0 ? PLAIN_OUTLINE : outline;
}

/**
 * Whether two stroke styles draw the same outline: the same join, miter limit, cap and dash
 * (pattern and offset; a null dash is the same as an absent one). Pure.
 *
 * @param a - One object's stroke style fields.
 * @param b - The other's.
 * @returns True when their meshes are the same as far as the style goes.
 */
export function isSameStrokeStyle(a: StrokeStyle, b: StrokeStyle): boolean {
  if (
    a.strokeJoin !== b.strokeJoin ||
    a.strokeMiterLimit !== b.strokeMiterLimit ||
    a.strokeCap !== b.strokeCap
  ) {
    return false;
  }
  const dashA = a.strokeDash ?? undefined;
  const dashB = b.strokeDash ?? undefined;
  if (dashA === dashB) return true;
  if (dashA === undefined || dashB === undefined) return false;
  return (
    (dashA.offset ?? 0) === (dashB.offset ?? 0) &&
    dashA.pattern.length === dashB.pattern.length &&
    dashA.pattern.every((length, index) => length === dashB.pattern[index])
  );
}

/**
 * How far an outline reaches past a stroke's centre line, world units: half the width, more for
 * a square cap (its corners, half the width times √2) and for miter joins (up to half the width
 * times the miter limit; a longer miter is bevelled). Pure.
 *
 * @param width - The stroke's width, world units.
 * @param outline - The outline.
 * @returns The reach, at least half the width.
 */
export function strokeOutlineReach(width: number, outline: StrokeOutline): number {
  const square = outline.cap === 'square' ? Math.SQRT2 : 1;
  const miter = outline.join === 'miter' ? (outline.miterLimit ?? DEFAULT_STROKE_MITER_LIMIT) : 1;
  return (width / 2) * Math.max(square, miter);
}

/**
 * An outline with round joins: the same dash, cap and miter limit, no join style. A curve's
 * flattening has no corners, so its points join round whatever the style. Pure.
 *
 * @param outline - The outline; not mutated.
 * @returns The outline without its join.
 */
export function roundJoined(outline: StrokeOutline): StrokeOutline {
  if (outline.join === undefined) return outline;
  const rest: { -readonly [Key in keyof StrokeOutline]: StrokeOutline[Key] } = { ...outline };
  delete rest.join;
  return rest;
}
