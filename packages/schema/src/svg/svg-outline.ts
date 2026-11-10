// The outlines of SVG elements (SVG 2 §10): each basic shape as the path data SVG
// defines it, read into subpaths in the element's user space, and the tight bounds SVG measures
// for `objectBoundingBox` units. Pure.
import type { Point } from '../fields/point.js';
import type { Rect } from '../geometry/local-bounds.js';

import type { OutlinePiece, Subpath } from './svg-geometry.js';
import { readPathData } from './svg-path-data.js';
import { excerpt, readLength, readPoints } from './svg-values.js';
import { report, type Walk } from './svg-walk.js';
import type { SvgElement } from './svg-xml.js';

/**
 * The tight bounds of subpaths: ends, and each cubic's extremes (where its derivative is zero),
 * as SVG measures an element's bounding box for `objectBoundingBox` units.
 *
 * @param subpaths - The subpaths.
 * @returns The bounds.
 */
export function tightBounds(subpaths: readonly Subpath[]): Rect {
  const points: Point[] = [];
  for (const subpath of subpaths) {
    let from = subpath.start;
    points.push(from);
    for (const piece of subpath.pieces) {
      points.push(piece.to);
      if (piece.kind === 'cubic') points.push(...cubicExtremes(from, piece));
      from = piece.to;
    }
  }
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The points of a cubic where x or y is extreme inside it.
 *
 * @param from - The cubic's start.
 * @param piece - The cubic.
 * @returns The points.
 */
function cubicExtremes(from: Point, piece: Extract<OutlinePiece, { kind: 'cubic' }>): Point[] {
  const ts: number[] = [];
  for (const axis of ['x', 'y'] as const) {
    const p0 = from[axis];
    const p1 = piece.c1[axis];
    const p2 = piece.c2[axis];
    const p3 = piece.to[axis];
    // The derivative's coefficients: a t² + b t + c.
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) {
      if (b !== 0) ts.push(-c / b);
      continue;
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    ts.push((-b + root) / (2 * a), (-b - root) / (2 * a));
  }
  return ts
    .filter((t) => t > 0 && t < 1)
    .map((t) => {
      const s = 1 - t;
      const blend = (p0: number, p1: number, p2: number, p3: number): number =>
        s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
      return {
        x: blend(from.x, piece.c1.x, piece.c2.x, piece.to.x),
        y: blend(from.y, piece.c1.y, piece.c2.y, piece.to.y),
      };
    });
}

/**
 * Formats a number for path data.
 *
 * @param value - The number.
 * @returns Its shortest exact text.
 */
const n = (value: number): string => String(value);

/**
 * An element's `x` and `y`: user-unit lengths, 0 when absent or unreadable (reported).
 *
 * @param element - The element.
 * @param walk - Where an unreadable length is reported.
 * @returns The position.
 */
export function positionOf(element: SvgElement, walk: Walk): Point {
  const values = lengths(
    element,
    [
      ['x', 0],
      ['y', 0],
    ],
    walk,
  );
  return values === undefined ? { x: 0, y: 0 } : { x: Number(values[0]), y: Number(values[1]) };
}

/** The outline of an element in its user space, and which shape could draw it exactly. */
export interface Outline {
  readonly subpaths: readonly Subpath[];
  /** A box the outline exactly fills, as a rectangle (with a corner radius) or an ellipse. */
  readonly box?: {
    readonly kind: 'rectangle' | 'ellipse';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly radius: number;
  };
}

/**
 * Reads lengths of an element: each a user-unit number, `fallback` when absent.
 *
 * @param element - The element.
 * @param names - The attributes and their fallbacks.
 * @param walk - Where an unreadable length is reported.
 * @returns The lengths in order, or undefined when one is unreadable.
 */
export function lengths(
  element: SvgElement,
  names: readonly (readonly [string, number])[],
  walk: Walk,
): number[] | undefined {
  const values: number[] = [];
  for (const [name, fallback] of names) {
    const written = element.attributes.get(name);
    const value = written === undefined ? fallback : readLength(written);
    if (value === undefined) {
      report(walk, {
        feature: 'length',
        detail: `<${element.name}> ${name}="${excerpt(String(written))}" is not in user units; not drawn`,
      });
      return undefined;
    }
    values.push(value);
  }
  return values;
}

/**
 * Reads path data that the import wrote itself, so it is well formed.
 *
 * @param text - The path data.
 * @returns Its subpaths.
 */
function data(text: string): Subpath[] {
  return [...readPathData(text).subpaths];
}

/**
 * A `<rect>`'s outline: four sides, with elliptical corners when `rx` or `ry` is set (each
 * defaulting to the other, clamped to half the side). A shape draws it when its corners are round.
 *
 * @param element - The `<rect>`.
 * @param walk - Where an unreadable length is reported.
 * @returns The outline, or undefined when it draws nothing.
 */
function rectOutline(element: SvgElement, walk: Walk): Outline | undefined {
  const values = lengths(
    element,
    [
      ['x', 0],
      ['y', 0],
      ['width', 0],
      ['height', 0],
    ],
    walk,
  );
  if (values === undefined) return undefined;
  const [x = 0, y = 0, width = 0, height = 0] = values;
  if (!(width > 0) || !(height > 0)) return undefined;
  const rxWritten = readLength(element.attributes.get('rx'));
  const ryWritten = readLength(element.attributes.get('ry'));
  const rx = Math.min(width / 2, Math.max(0, rxWritten ?? ryWritten ?? 0));
  const ry = Math.min(height / 2, Math.max(0, ryWritten ?? rxWritten ?? 0));
  const box = { x, y, width, height, radius: rx };
  if (rx === 0 || ry === 0) {
    return {
      subpaths: data(`M${n(x)} ${n(y)}H${n(x + width)}V${n(y + height)}H${n(x)}Z`),
      box: { kind: 'rectangle', ...box, radius: 0 },
    };
  }
  const arc = (dx: number, dy: number): string => `A${n(rx)} ${n(ry)} 0 0 1 ${n(dx)} ${n(dy)}`;
  const subpaths = data(
    `M${n(x + rx)} ${n(y)}H${n(x + width - rx)}${arc(x + width, y + ry)}` +
      `V${n(y + height - ry)}${arc(x + width - rx, y + height)}H${n(x + rx)}` +
      `${arc(x, y + height - ry)}V${n(y + ry)}${arc(x + rx, y)}Z`,
  );
  return rx === ry ? { subpaths, box: { kind: 'rectangle', ...box } } : { subpaths };
}

/**
 * A `<circle>`'s or `<ellipse>`'s outline: four quarter arcs; an ellipse missing one radius uses
 * the other. A shape always draws it.
 *
 * @param element - The `<circle>` or `<ellipse>`.
 * @param walk - Where an unreadable length is reported.
 * @returns The outline, or undefined when it draws nothing.
 */
function ellipseOutline(element: SvgElement, walk: Walk): Outline | undefined {
  const isCircle = element.name === 'circle';
  const radii = isCircle
    ? [['r', 0]]
    : [
        ['rx', Number.NaN],
        ['ry', Number.NaN],
      ];
  const values = lengths(element, [['cx', 0], ['cy', 0], ...(radii as [string, number][])], walk);
  if (values === undefined) return undefined;
  const [cx = 0, cy = 0, first = 0, second = first] = values;
  // An ellipse with one radius missing ("auto") uses the other.
  const rx = Number.isNaN(first) ? second : first;
  const ry = isCircle ? first : Number.isNaN(second) ? first : second;
  if (!(rx > 0) || !(ry > 0)) return undefined;
  const quarter = (x: number, y: number): string => `A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y)}`;
  return {
    subpaths: data(
      `M${n(cx + rx)} ${n(cy)}${quarter(cx, cy + ry)}${quarter(cx - rx, cy)}` +
        `${quarter(cx, cy - ry)}${quarter(cx + rx, cy)}Z`,
    ),
    box: { kind: 'ellipse', x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry, radius: 0 },
  };
}

/**
 * The outline of a basic shape element or a path, in its user space (SVG 2 §10).
 *
 * @param element - A drawable element.
 * @param walk - Where problems are reported.
 * @returns The outline, or undefined when it draws nothing.
 */
export function outlineOf(element: SvgElement, walk: Walk): Outline | undefined {
  switch (element.name) {
    case 'path': {
      const { subpaths, error } = readPathData(element.attributes.get('d') ?? '');
      if (error !== undefined) {
        report(walk, { feature: 'path data', detail: `${error}; drawn up to it` });
      }
      return { subpaths };
    }
    case 'rect':
      return rectOutline(element, walk);
    case 'circle':
    case 'ellipse':
      return ellipseOutline(element, walk);
    case 'line': {
      const values = lengths(
        element,
        [
          ['x1', 0],
          ['y1', 0],
          ['x2', 0],
          ['y2', 0],
        ],
        walk,
      );
      if (values === undefined) return undefined;
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
      return { subpaths: data(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`) };
    }
    default: {
      const points = readPoints(element.attributes.get('points') ?? '');
      if (points === undefined) {
        report(walk, {
          feature: 'points',
          detail: `<${element.name}> points are unreadable; not drawn`,
        });
        return undefined;
      }
      const [start, ...rest] = points;
      if (start === undefined) return undefined;
      const close = element.name === 'polygon' ? 'Z' : '';
      return {
        subpaths: data(
          `M${n(start.x)} ${n(start.y)}${rest.map((p) => `L${n(p.x)} ${n(p.y)}`).join('')}${close}`,
        ),
      };
    }
  }
}
