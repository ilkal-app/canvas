// The dash, join and cap of an imported SVG stroke: `stroke-dasharray` and
// `stroke-dashoffset`, `stroke-linejoin` and `stroke-miterlimit`, and `stroke-linecap`, mapped
// onto a path's stroke style. A field is written only where it changes the drawing: a cap where
// a subpath is open, a join where the outline turns a corner, and neither when round (the
// board's default). What cannot be mapped is reported and drawn the nearest way. Pure.
import {
  DEFAULT_STROKE_MITER_LIMIT,
  MAX_STROKE_DASH_ENTRIES,
  MAX_STROKE_DASH_LENGTH,
  MAX_STROKE_MITER_LIMIT,
  type StrokeCap,
  type StrokeDash,
  type StrokeJoin,
  type StrokeStyle,
} from '../fields/stroke-style.js';

import { hasOpenSubpath } from './svg-network.js';
import { hasSharpCorner, strokeScaleOf, type Drawing } from './svg-stroke.js';
import { excerpt, readLength, readNumberList } from './svg-values.js';
import { report, type Walk } from './svg-walk.js';

/** The caps the board draws, by their SVG names. */
const CAPS: ReadonlySet<string> = new Set<StrokeCap>(['butt', 'round', 'square']);

/** The SVG 2 joins the board draws as a miter (bevelled past the limit). */
const MITER_LIKE: ReadonlySet<string> = new Set(['miter-clip', 'arcs']);

/**
 * The stroke cap of an element with an open subpath: its `stroke-linecap`, absent for round.
 *
 * @param drawing - The element.
 * @param walk - Where an unknown cap is reported.
 * @returns The cap, or undefined for round.
 */
function capOf(drawing: Drawing, walk: Walk): StrokeCap | undefined {
  const written = drawing.style.strokeLinecap;
  if (CAPS.has(written)) return written === 'round' ? undefined : (written as StrokeCap);
  report(walk, { feature: 'stroke-linecap', detail: `"${excerpt(written)}" is drawn butt` });
  return 'butt';
}

/**
 * The stroke join and miter limit of an element whose outline turns a corner: its
 * `stroke-linejoin`, absent for round, and its `stroke-miterlimit` where a miter's differs from 4.
 *
 * @param drawing - The element.
 * @param walk - Where approximations are reported.
 * @returns The join fields.
 */
function joinOf(
  drawing: Drawing,
  walk: Walk,
): Pick<StrokeStyle, 'strokeJoin' | 'strokeMiterLimit'> {
  const { strokeLinejoin: written, strokeMiterlimit: limit } = drawing.style;
  if (written === 'round') return {};
  if (written === 'bevel') return { strokeJoin: 'bevel' };
  if (MITER_LIKE.has(written)) {
    report(walk, {
      feature: 'stroke-linejoin',
      detail: `"${written}" joins are drawn as miter joins, bevelled past the miter limit`,
    });
  } else if (written !== 'miter') {
    report(walk, { feature: 'stroke-linejoin', detail: `"${excerpt(written)}" is drawn miter` });
  }
  const join: StrokeJoin = 'miter';
  if (limit === DEFAULT_STROKE_MITER_LIMIT) return { strokeJoin: join };
  if (limit > MAX_STROKE_MITER_LIMIT) {
    report(walk, {
      feature: 'stroke-miterlimit',
      detail: `miter limits above ${String(MAX_STROKE_MITER_LIMIT)} are drawn as ${String(MAX_STROKE_MITER_LIMIT)}`,
    });
  }
  return { strokeJoin: join, strokeMiterLimit: Math.min(limit, MAX_STROKE_MITER_LIMIT) };
}

/**
 * The dash of an element: its `stroke-dasharray` and `stroke-dashoffset` in board units (scaled
 * as its stroke's width is), or undefined for a solid stroke. A list SVG itself draws solid
 * (`none`, a negative length, all zero) is solid without a report; one the board cannot hold
 * (not user units, more than 8 lengths, a length past 4096) is reported and drawn solid.
 *
 * @param drawing - The element.
 * @param walk - Where problems are reported.
 * @returns The dash, or undefined.
 */
function dashOf(drawing: Drawing, walk: Walk): StrokeDash | undefined {
  const { strokeDasharray: written, strokeDashoffset: writtenOffset } = drawing.style;
  if (written.trim() === 'none') return undefined;
  const lengths = readNumberList(written.replace(/px/g, ''));
  if (lengths === undefined || lengths.length === 0) {
    const detail = `"${excerpt(written)}" is not a list of user-unit lengths; drawn solid`;
    report(walk, { feature: 'stroke-dasharray', detail });
    return undefined;
  }
  if (lengths.some((length) => length < 0) || lengths.every((length) => length === 0)) {
    return undefined;
  }
  const scale = strokeScaleOf(drawing);
  const pattern = lengths.map((length) => length * scale);
  if (pattern.length > MAX_STROKE_DASH_ENTRIES || pattern.some((l) => l > MAX_STROKE_DASH_LENGTH)) {
    const detail = `patterns of more than ${String(MAX_STROKE_DASH_ENTRIES)} lengths, or lengths past ${String(MAX_STROKE_DASH_LENGTH)}, are drawn solid`;
    report(walk, { feature: 'stroke-dasharray', detail });
    return undefined;
  }
  const offset = readLength(writtenOffset);
  if (offset === undefined) {
    const detail = `"${excerpt(writtenOffset)}" is not in user units; drawn 0`;
    report(walk, { feature: 'stroke-dashoffset', detail });
  }
  // The offset matters modulo the pattern's period; kept within half a period of 0, so within
  // the schema's range.
  const period = pattern.reduce((sum, length) => sum + length, 0) * ((pattern.length % 2) + 1);
  const shifted = ((((offset ?? 0) * scale) % period) + period) % period;
  const centred = shifted > period / 2 ? shifted - period : shifted;
  return centred === 0 ? { pattern } : { pattern, offset: centred };
}

/**
 * The stroke style an element's stroke draws with on the board: its dash, and where
 * they show, its join (at a corner, `hasSharpCorner`) and cap (on an open subpath). Fields equal
 * to the board's default (round, solid) are left out, so an icon drawn round imports as before.
 *
 * @param drawing - The element, stroked.
 * @param walk - Where approximations are reported.
 * @returns The stroke style fields to set on its stroked path.
 */
export function boardStrokeStyle(drawing: Drawing, walk: Walk): StrokeStyle {
  const { subpaths } = drawing.outline;
  const strokeCap = hasOpenSubpath(subpaths) ? capOf(drawing, walk) : undefined;
  const join = subpaths.some(hasSharpCorner) ? joinOf(drawing, walk) : {};
  const strokeDash = dashOf(drawing, walk);
  return {
    ...(strokeDash === undefined ? {} : { strokeDash }),
    ...join,
    ...(strokeCap === undefined ? {} : { strokeCap }),
  };
}
