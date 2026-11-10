// A gradient's colour line resolved as COLRv1 defines it, for writers that spread a line
// over 0..1 (SVG, PDF): stops resolved to RGBA; the line running from its first stop to its last,
// so repeat and reflect cycle over that interval; a radial cone cut where its radius reaches zero,
// since no part of the cone with a negative radius is painted. Pure.
import type { VectorFill, VectorGradient } from './colour-layers.js';

/** An RGBA colour, each channel 0..1. */
export type Rgba = readonly [number, number, number, number];

/** Resolves a fill to RGBA. */
export type ColorOf = (fill: VectorFill) => Rgba;

/** A stop of a resolved colour line: its place on 0..1 and its colour, alpha multiplied in. */
export interface ResolvedStop {
  /** Where along the line, 0..1. */
  readonly offset: number;
  /** The colour there. */
  readonly rgba: Rgba;
}

/** A gradient whose geometry spans its colour line's 0..1, with that line's resolved stops. */
export interface ColourLine<G extends VectorGradient> {
  /** The geometry: a linear gradient's ends, a radial's circles, a sweep's angles. */
  readonly gradient: G;
  /** The stops, offsets from 0 to 1 in order. */
  readonly stops: readonly ResolvedStop[];
}

/**
 * A value between two, at a fraction.
 *
 * @param from - At 0.
 * @param to - At 1.
 * @param t - The fraction.
 * @returns The value.
 */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * The colour of resolved stops at a place, interpolated; clamped past the ends.
 *
 * @param stops - The stops, in order, at least one.
 * @param t - The place.
 * @returns The colour.
 */
export function colourAtStops(stops: readonly ResolvedStop[], t: number): Rgba {
  let previous: ResolvedStop | undefined;
  for (const stop of stops) {
    if (stop.offset >= t) {
      if (previous === undefined || stop.offset === previous.offset) return stop.rgba;
      const k = (t - previous.offset) / (stop.offset - previous.offset);
      const from = previous.rgba;
      const mix = (index: 0 | 1 | 2 | 3) => lerp(from[index], stop.rgba[index], k);
      return [mix(0), mix(1), mix(2), mix(3)];
    }
    previous = stop;
  }
  return previous?.rgba ?? [0, 0, 0, 0];
}

/**
 * A gradient's geometry moved so that `from` and `to`, places on its colour line, become its ends.
 *
 * @param gradient - The gradient.
 * @param from - The new start.
 * @param to - The new end.
 * @returns The moved geometry.
 */
function moved<G extends VectorGradient>(gradient: G, from: number, to: number): G {
  if (gradient.kind === 'linear') {
    const { x0, y0, x1, y1 } = gradient;
    return {
      ...gradient,
      x0: lerp(x0, x1, from),
      y0: lerp(y0, y1, from),
      x1: lerp(x0, x1, to),
      y1: lerp(y0, y1, to),
    };
  }
  if (gradient.kind === 'radial') {
    const { x0, y0, r0, x1, y1, r1 } = gradient;
    return {
      ...gradient,
      ...{ x0: lerp(x0, x1, from), y0: lerp(y0, y1, from), r0: lerp(r0, r1, from) },
      ...{ x1: lerp(x0, x1, to), y1: lerp(y0, y1, to), r1: lerp(r0, r1, to) },
    };
  }
  const { startAngle, endAngle } = gradient;
  return {
    ...gradient,
    startAngle: lerp(startAngle, endAngle, from),
    endAngle: lerp(startAngle, endAngle, to),
  };
}

/**
 * A line's geometry and stops over a window of it, `from` to `to` (both on the old line), with
 * the radius at the tip end set to exactly zero. Direction is kept: COLRv1 paints the largest
 * position on top where circles cross, so a cut never reverses the cone.
 *
 * @param gradient - The radial gradient.
 * @param from - The window's start.
 * @param to - The window's end.
 * @param stops - The stops, placed on 0..1 of the window, in order.
 * @param isTipAtStart - Whether the tip is the window's start (else its end).
 * @returns The cut line.
 */
function windowed<G extends VectorGradient>(
  gradient: G,
  from: number,
  to: number,
  stops: readonly ResolvedStop[],
  isTipAtStart: boolean,
): ColourLine<G> {
  const cone = moved(gradient, from, to);
  return { gradient: { ...cone, ...(isTipAtStart ? { r0: 0 } : { r1: 0 }) }, stops };
}

/**
 * The cut line of a padded cone: the window from the tip to the line's far end on the visible
 * side (past which pad holds the end colour), or a unit window in the end colour when the tip
 * lies beyond the line. Stops keep their order, so a duplicate pair at the tip starts with the
 * visible side's colour.
 *
 * @param line - The normalised radial line.
 * @param tip - Where on it the radius is zero.
 * @param side - 1 when the radius grows past the tip, -1 when it grows before it.
 * @returns The cut line.
 */
function padCut<G extends VectorGradient>(
  line: ColourLine<G>,
  tip: number,
  side: 1 | -1,
): ColourLine<G> {
  const { gradient, stops } = line;
  const isBeyond = side > 0 ? tip >= 1 : tip <= 0;
  if (isBeyond) {
    const end = colourAtStops(stops, side * Infinity);
    const flat = [
      { offset: 0, rgba: end },
      { offset: 1, rgba: end },
    ];
    return side > 0
      ? windowed(gradient, tip, tip + 1, flat, true)
      : windowed(gradient, tip - 1, tip, flat, false);
  }
  const [from, to] = side > 0 ? [tip, 1] : [0, tip];
  const kept = stops
    .map(({ offset, rgba }) => ({ offset: (offset - from) / (to - from), rgba }))
    .filter(({ offset }) => offset >= 0 && offset <= 1);
  const tipOffset = side > 0 ? 0 : 1;
  const hasTipStop = kept.some(({ offset }) => offset === tipOffset);
  const atTip = hasTipStop ? [] : [{ offset: tipOffset, rgba: colourAtStops(stops, tip) }];
  const placed = side > 0 ? [...atTip, ...kept] : [...kept, ...atTip];
  return windowed(gradient, from, to, placed, side > 0);
}

/**
 * The cut line of a repeating or reflecting cone: the one period of the colour pattern that
 * starts (or ends) at the tip on the visible side, spread by repeat. A reflecting line's period is
 * the line and its mirror. Each stop is placed at every copy of it in the window, a copy from an
 * earlier period first where two meet at a seam, so the window's ends take the right sides'
 * colours.
 *
 * @param line - The normalised radial line.
 * @param tip - Where on it the radius is zero.
 * @param side - 1 when the radius grows past the tip, -1 when it grows before it.
 * @returns The cut line.
 */
function periodicCut<G extends VectorGradient>(
  line: ColourLine<G>,
  tip: number,
  side: 1 | -1,
): ColourLine<G> {
  const { gradient, stops } = line;
  const period = gradient.extend === 'reflect' ? 2 : 1;
  const mirrored = [...stops].reverse().map(({ offset, rgba }) => ({ offset: 2 - offset, rgba }));
  const pattern = period === 2 ? [...stops, ...mirrored] : stops;
  const from = side > 0 ? tip : tip - period;
  const copies = pattern.flatMap(({ offset, rgba }, index) => {
    const first = Math.ceil((from - offset) / period);
    const last = Math.floor((from + period - offset) / period);
    const found = [];
    for (let k = first; k <= last; k += 1)
      found.push({ offset: (offset + k * period - from) / period, rgba, k, index });
    return found;
  });
  copies.sort((a, b) => a.offset - b.offset || a.k - b.k || a.index - b.index);
  const placed = copies.map(({ offset, rgba }) => ({ offset, rgba }));
  // The window's ends, where no stop lands on them, wrap from the period's other end.
  const wrapBefore = placed.slice(-1).map(({ offset, rgba }) => ({ offset: offset - 1, rgba }));
  const wrapAfter = placed.slice(0, 1).map(({ offset, rgba }) => ({ offset: offset + 1, rgba }));
  const atStart = placed.some(({ offset }) => offset === 0)
    ? []
    : [{ offset: 0, rgba: colourAtStops([...wrapBefore, ...placed], 0) }];
  const atEnd = placed.some(({ offset }) => offset === 1)
    ? []
    : [{ offset: 1, rgba: colourAtStops([...placed, ...wrapAfter], 1) }];
  const cut = windowed(gradient, from, from + period, [...atStart, ...placed, ...atEnd], side > 0);
  return { ...cut, gradient: { ...cut.gradient, extend: 'repeat' } };
}

/**
 * A normalised radial cone cut at its zero-radius tip: COLRv1 paints no part of a cone with a
 * negative radius, so the line is re-expressed over a window bounded by the tip on the side where
 * the radius grows, in the cone's own direction, exactly, for pad, repeat and reflect, even when
 * the tip lies past the stops.
 *
 * @param line - The normalised line.
 * @returns The line, cut when it is a radial cone with a negative radius; null when the radius is
 * negative everywhere.
 */
function cutCone<G extends VectorGradient>(line: ColourLine<G>): ColourLine<G> | null {
  const { gradient } = line;
  if (gradient.kind !== 'radial') return line;
  const { r0, r1 } = gradient;
  if (r0 >= 0 && r1 >= 0) return line;
  if (r0 === r1) return null;
  const tip = r0 / (r0 - r1);
  const side = r1 > r0 ? 1 : -1;
  return gradient.extend === 'pad' ? padCut(line, tip, side) : periodicCut(line, tip, side);
}

/**
 * A gradient's colour line resolved for a writer that spreads it over 0..1: stops resolved to RGBA
 * (a stop's alpha multiplied in); the geometry moved to the first and last stops and the stops
 * remapped onto 0..1, so repeat and reflect cycle between them as COLRv1 does; a radial cone cut
 * at its zero-radius tip (exactly, for every spread). When every stop shares one offset, COLRv1 paints nothing for repeat or
 * reflect (null) and pad is a hard step there, drawn by starting the line at that offset with both
 * stops at 0.
 *
 * @param gradient - The gradient, its stops in offset order.
 * @param colorOf - Resolves the stops' colours.
 * @returns The resolved line, or null when it paints nothing (no stops, or as above); the input
 * is not changed.
 */
export function colourLineOf<G extends VectorGradient>(
  gradient: G,
  colorOf: ColorOf,
): ColourLine<G> | null {
  const resolved = gradient.stops.map(({ offset, color, alpha = 1 }) => {
    const [r, g, b, a] = colorOf(color);
    return { offset, rgba: [r, g, b, a * alpha] as const };
  });
  if (resolved.length === 0) return null;
  const first = Math.min(...resolved.map(({ offset }) => offset));
  const last = Math.max(...resolved.map(({ offset }) => offset));
  if (last === first) {
    if (gradient.extend !== 'pad') return null;
    const stops = resolved.map(({ rgba }) => ({ offset: 0, rgba }));
    return cutCone({ gradient: moved(gradient, first, first + 1), stops });
  }
  const stops = resolved.map(({ offset, rgba }) => ({
    offset: (offset - first) / (last - first),
    rgba,
  }));
  return cutCone({ gradient: moved(gradient, first, last), stops });
}
