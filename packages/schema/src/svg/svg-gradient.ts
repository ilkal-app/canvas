// SVG gradients onto the board's. The board's gradients live in an object's paint
// unit box (`paintBoxOf`): a linear one is a direction and stops spanning the box, a radial one a
// centre and radius in box units. An SVG linear gradient, through any chain of transforms, is
// still linear in the unit box, so it maps exactly: its direction gives the angle, and its stops
// are moved to where they fall along the board's span (cut at the box's ends, padded beyond). A
// radial gradient maps exactly when the unit box sees its circle as a circle, without a focal
// point; otherwise, and for more than eight stops or `reflect`/`repeat`, the import draws an
// approximation and reports it. Pure.
import type { Rgba } from '../fields/color.js';
import {
  MAX_GRADIENT_STOPS,
  MAX_RADIAL_RADIUS,
  paintColorAt,
  type GradientStop,
  type Paint,
} from '../fields/paint.js';
import { mapPoint, type AffineMap } from '../geometry/affine-map.js';
import type { Rect } from '../geometry/local-bounds.js';

import { composeMaps, IDENTITY, invertMap } from './svg-geometry.js';
import { SVG_IMPORT_LIMITS } from './svg-limits.js';
import { GRADIENTS, type SvgIssue } from './svg-paint.js';
import { ownProperty } from './svg-style.js';
import { excerpt, readColor, readFraction, readTransform } from './svg-values.js';
import type { SvgElement } from './svg-xml.js';

/** Where a gradient is drawn: the frames it passes through on the way to the object's unit box. */
export interface GradientFrame {
  /** From the element's user space to the group's frame. */
  readonly ctm: AffineMap;
  /** The element's geometry bounds in its user space (for `objectBoundingBox` units). */
  readonly bbox: Rect;
  /** From the object's paint unit box to the group's frame. */
  readonly unitBox: AffineMap;
  /** Multiplies every stop's alpha: the fill or stroke opacity times the element's opacity. */
  readonly opacity: number;
  /** What `currentColor` is for this element. */
  readonly currentColor: Rgba;
}

/** A gradient on the board, or the colour that stands in for it, and what was approximated. */
export interface GradientOutcome {
  /** The paint, or null when the gradient draws nothing. */
  readonly paint: Paint | null;
  /** What was approximated. */
  readonly issues: readonly SvgIssue[];
}

/**
 * A gradient and the gradients it inherits from by `href`, nearest first; a cycle, a reference
 * to something else or the cap (`SVG_IMPORT_LIMITS.maxGradientChain`) ends the chain.
 *
 * @param gradient - The gradient.
 * @param ids - The document's elements by id.
 * @returns The chain.
 */
function gradientChain(gradient: SvgElement, ids: ReadonlyMap<string, SvgElement>): SvgElement[] {
  const chain = [gradient];
  let last = gradient;
  while (chain.length < SVG_IMPORT_LIMITS.maxGradientChain) {
    const href = last.attributes.get('href') ?? last.attributes.get('xlink:href') ?? '';
    const next = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
    if (next === undefined || !GRADIENTS.has(next.name) || chain.includes(next)) return chain;
    chain.push(next);
    last = next;
  }
  return chain;
}

/**
 * A gradient's stops: offsets clamped to [0, 1] and made non-decreasing, colours with
 * `stop-opacity` and the frame's opacity applied.
 *
 * @param chain - The gradient's chain; the first with stops gives them.
 * @param frame - The frame, for `currentColor` and the opacity.
 * @param issues - Where an unreadable stop colour is reported.
 * @returns The stops.
 */
function stopsOf(
  chain: readonly SvgElement[],
  frame: Pick<GradientFrame, 'opacity' | 'currentColor'>,
  issues: SvgIssue[],
): GradientStop[] {
  const owner = chain.find((element) => element.children.some((child) => child.name === 'stop'));
  let previous = 0;
  return (owner?.children ?? [])
    .filter((child) => child.name === 'stop')
    .map((stop) => {
      const offset = Math.max(
        previous,
        Math.min(1, Math.max(0, readFraction(stop.attributes.get('offset')) ?? 0)),
      );
      previous = offset;
      const written = ownProperty(stop, 'stop-color')?.trim() ?? 'black';
      let color =
        written.toLowerCase() === 'currentcolor' ? frame.currentColor : readColor(written);
      if (color === undefined) {
        issues.push({
          feature: 'paint',
          detail: `stop colour "${excerpt(written)}" is not a colour the board reads; drawn black`,
        });
        color = [0, 0, 0, 1];
      }
      const stopOpacity = readFraction(ownProperty(stop, 'stop-opacity')) ?? 1;
      const alpha = color[3] * Math.min(1, Math.max(0, stopOpacity)) * frame.opacity;
      return { offset, color: [color[0], color[1], color[2], alpha] };
    });
}

/**
 * The colour of SVG stops at a position along them, padded beyond the ends; interpolated as the
 * board interpolates (premultiplied).
 *
 * @param stops - At least one stop.
 * @param t - The position.
 * @returns The colour.
 */
function colorAt(stops: readonly GradientStop[], t: number): Rgba {
  // A linear gradient at angle 0 has t = u; one stop pads to its colour everywhere.
  return paintColorAt({ type: 'linear', angle: 0, stops: [...stops] }, t, 0.5);
}

/**
 * The board stops of SVG stops seen through `t_svg = scale · t_board + shift`: the board's span
 * [0, 1] covers SVG positions [shift, scale + shift], so its ends take the colours there and the
 * SVG stops inside move in. Above eight, they are resampled evenly.
 *
 * @param stops - The SVG stops.
 * @param scale - How far the SVG position moves per unit along the board's span; above 0.
 * @param shift - The SVG position at the board's 0.
 * @param issues - Where a resampling is reported.
 * @returns Two to eight board stops.
 */
function boardStops(
  stops: readonly GradientStop[],
  scale: number,
  shift: number,
  issues: SvgIssue[],
): GradientStop[] {
  const inside = stops
    .map((stop) => ({ offset: (stop.offset - shift) / scale, color: stop.color }))
    .filter((stop) => stop.offset > 0 && stop.offset < 1);
  const result = [
    { offset: 0, color: colorAt(stops, shift) },
    ...inside,
    { offset: 1, color: colorAt(stops, scale + shift) },
  ];
  if (result.length <= MAX_GRADIENT_STOPS) return result;
  issues.push({
    feature: 'gradient stops',
    detail: `more than ${String(MAX_GRADIENT_STOPS)} stops; resampled to ${String(MAX_GRADIENT_STOPS)}`,
  });
  return Array.from({ length: MAX_GRADIENT_STOPS }, (unused, index) => {
    const offset = index / (MAX_GRADIENT_STOPS - 1);
    return { offset, color: colorAt(stops, scale * offset + shift) };
  });
}

/**
 * A gradient coordinate: in `objectBoundingBox` units a number or percentage, in
 * `userSpaceOnUse` a number (a percentage there depends on a viewport the board does not keep).
 *
 * @param chain - The gradient's chain; the nearest that sets the attribute gives it.
 * @param name - The attribute.
 * @param fallback - Its initial value, as a fraction.
 * @param isUserSpace - Whether the units are `userSpaceOnUse`.
 * @returns The coordinate, or undefined when unreadable.
 */
function coordinate(
  chain: readonly SvgElement[],
  name: string,
  fallback: number,
  isUserSpace: boolean,
): number | undefined {
  const value = chain.find((element) => element.attributes.has(name))?.attributes.get(name);
  if (value === undefined) return fallback;
  if (isUserSpace && value.trim().endsWith('%')) return undefined;
  return readFraction(value);
}

/**
 * The nearest value of an attribute along a gradient's chain.
 *
 * @param chain - The chain.
 * @param name - The attribute.
 * @returns The value, or undefined.
 */
function inherited(chain: readonly SvgElement[], name: string): string | undefined {
  return chain.find((element) => element.attributes.has(name))?.attributes.get(name);
}

/**
 * The colour halfway along a gradient, which stands in for it where the board draws one colour
 * (a stroke).
 *
 * @param gradient - The `linearGradient` or `radialGradient` element.
 * @param ids - The document's elements by id.
 * @param frame - Its opacity and `currentColor`.
 * @returns The colour, or null when the gradient has no stops.
 */
export function gradientMiddleColor(
  gradient: SvgElement,
  ids: ReadonlyMap<string, SvgElement>,
  frame: Pick<GradientFrame, 'opacity' | 'currentColor'>,
): Rgba | null {
  const stops = stopsOf(gradientChain(gradient, ids), frame, []);
  return stops.length === 0 ? null : colorAt(stops, 0.5);
}

/** What a linear or radial mapping needs: the gradient's chain, stops and frames. */
interface GradientMapping {
  /** The gradient and the gradients it inherits from. */
  readonly chain: readonly SvgElement[];
  /** At least two stops. */
  readonly stops: readonly GradientStop[];
  /** From the object's unit box into the gradient's own space. */
  readonly unitToGradient: AffineMap;
  /** Whether the gradient's coordinates are in user space. */
  readonly isUserSpace: boolean;
  /** Where approximations are added. */
  readonly issues: SvgIssue[];
}

/**
 * The approximation of a gradient the board cannot draw: its colour halfway along, reported.
 *
 * @param mapping - The gradient.
 * @param detail - Why.
 * @returns The outcome.
 */
function approximate(mapping: GradientMapping, detail: string): GradientOutcome {
  return {
    paint: colorAt(mapping.stops, 0.5),
    issues: [...mapping.issues, { feature: 'gradient', detail: `${detail}; drawn as one colour` }],
  };
}

/**
 * The last of some stops.
 *
 * @param stops - At least one stop.
 * @returns The last.
 */
function lastStop(stops: readonly GradientStop[]): GradientStop {
  return stops.reduce((unused, stop) => stop);
}

/**
 * A linear gradient on the board: exact, since a linear gradient stays linear in the unit box.
 *
 * @param mapping - The gradient.
 * @returns The outcome.
 */
function linearPaint(mapping: GradientMapping): GradientOutcome {
  const { chain, stops, unitToGradient, isUserSpace, issues } = mapping;
  const read = (name: string, fallback: number): number | undefined =>
    coordinate(chain, name, fallback, isUserSpace);
  const x1 = read('x1', 0);
  const y1 = read('y1', 0);
  const x2 = read('x2', 1);
  const y2 = read('y2', 0);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return approximate(mapping, 'a coordinate is unreadable or a user-space percentage');
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { paint: lastStop(stops).color, issues };
  const tAt = (u: number, v: number): number => {
    const point = mapPoint(unitToGradient, { x: u, y: v });
    return ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSquared;
  };
  const origin = tAt(0, 0);
  const across = tAt(1, 0) - origin;
  const down = tAt(0, 1) - origin;
  const k = Math.hypot(across, down);
  // In (−π, π]: atan2 gives −π only for a −0 `down`, which a difference never is.
  const angle = Math.atan2(down, across);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const span = Math.abs(cos) + Math.abs(sin);
  // t_svg = k (u cos + v sin) + origin = scale · t_board + shift.
  const scale = k * span;
  const shift = origin + k * ((cos + sin) / 2 - span / 2);
  const paint = { type: 'linear', angle, stops: boardStops(stops, scale, shift, issues) } as const;
  return { paint, issues };
}

/**
 * A radial gradient on the board: exact when the unit box sees its circle round, centred inside
 * the box and at most twice its size; its focal point is drawn at the centre.
 *
 * @param mapping - The gradient.
 * @returns The outcome.
 */
function radialPaint(mapping: GradientMapping): GradientOutcome {
  const { chain, stops, unitToGradient, isUserSpace, issues } = mapping;
  const read = (name: string, fallback: number): number | undefined =>
    coordinate(chain, name, fallback, isUserSpace);
  const cx = read('cx', 0.5);
  const cy = read('cy', 0.5);
  const r = read('r', 0.5);
  if (cx === undefined || cy === undefined || r === undefined) {
    return approximate(mapping, 'a coordinate is unreadable or a user-space percentage');
  }
  if (read('fx', cx) !== cx || read('fy', cy) !== cy || read('fr', 0) !== 0) {
    issues.push({ feature: 'gradient', detail: 'a radial focal point is drawn at the centre' });
  }
  if (r <= 0) return { paint: lastStop(stops).color, issues };
  const { a, b, c, d } = unitToGradient;
  const across = Math.hypot(a, b);
  const down = Math.hypot(c, d);
  const isCircle =
    Math.abs(across - down) <= 1e-9 * Math.max(across, down) &&
    Math.abs(a * c + b * d) <= 1e-9 * across * down;
  // The centre in the unit box: the map's inverse applied to (cx, cy).
  const det = a * d - b * c;
  const ex = cx - unitToGradient.x;
  const ey = cy - unitToGradient.y;
  const center = { x: (d * ex - c * ey) / det, y: (a * ey - b * ex) / det };
  const radius = r / across;
  const isInside = center.x >= 0 && center.x <= 1 && center.y >= 0 && center.y <= 1;
  if (!isCircle || !isInside || !(radius <= MAX_RADIAL_RADIUS)) {
    return approximate(
      mapping,
      'the board draws radial gradients round in the box, centred inside it, up to twice its size',
    );
  }
  const stopsOnBoard = boardStops(stops, 1, 0, issues);
  return { paint: { type: 'radial', center, radius, stops: stopsOnBoard }, issues };
}

/**
 * Maps an SVG gradient onto the board's paint for one object: exactly where the board can draw
 * it, else an approximation (the colour halfway along it) and an issue.
 *
 * @param gradient - The `linearGradient` or `radialGradient` element.
 * @param ids - The document's elements by id.
 * @param frame - Where it is drawn.
 * @returns The paint and what was approximated.
 */
export function gradientPaint(
  gradient: SvgElement,
  ids: ReadonlyMap<string, SvgElement>,
  frame: GradientFrame,
): GradientOutcome {
  const issues: SvgIssue[] = [];
  const chain = gradientChain(gradient, ids);
  if (chain.length === SVG_IMPORT_LIMITS.maxGradientChain) {
    const cap = String(SVG_IMPORT_LIMITS.maxGradientChain);
    issues.push({ feature: 'gradient', detail: `an href chain is followed for ${cap} gradients` });
  }
  const stops = stopsOf(chain, frame, issues);
  const [first] = stops;
  if (first === undefined) return { paint: null, issues };
  if (stops.length === 1) return { paint: first.color, issues };
  const spread = inherited(chain, 'spreadMethod') ?? 'pad';
  if (spread !== 'pad') {
    issues.push({
      feature: 'gradient',
      detail: `spreadMethod "${excerpt(spread)}" drawn as "pad"`,
    });
  }
  const isUserSpace = inherited(chain, 'gradientUnits') === 'userSpaceOnUse';
  const transformValue = inherited(chain, 'gradientTransform');
  const transform = transformValue === undefined ? IDENTITY : readTransform(transformValue);
  const { bbox } = frame;
  const units = isUserSpace
    ? IDENTITY
    : { a: bbox.width, b: 0, c: 0, d: bbox.height, x: bbox.x, y: bbox.y };
  const toGroup = composeMaps(frame.ctm, composeMaps(units, transform ?? IDENTITY));
  const fromGroup = invertMap(toGroup);
  const unitToGradient = composeMaps(fromGroup ?? IDENTITY, frame.unitBox);
  const mapping = { chain, stops, unitToGradient, isUserSpace, issues };
  if (transform === undefined) return approximate(mapping, 'its gradientTransform is unreadable');
  if (fromGroup === undefined) return approximate(mapping, 'its frame is degenerate');
  return gradient.name === 'linearGradient' ? linearPaint(mapping) : radialPaint(mapping);
}
