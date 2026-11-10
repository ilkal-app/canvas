// A COLRv1 colour line as stops a canvas gradient can take: canvas gradients take
// offsets in 0..1 and only pad past their ends, so a colour line's offsets outside 0..1 and its
// repeat and reflect modes are written out as stops over a parameter range, and the gradient's
// geometry is stretched to that range.

import type { ColourGlyphExtend, ColourGlyphRgba, ColourGlyphStop } from '@canvas/text';

/** How many periods a repeating colour line is written out past each end of its stops. */
export const REPEAT_PERIODS = 8;

/** A stop along a colour line's parameter, t: 0 at the gradient's start, 1 at its end. */
export interface ParamStop {
  /** Where along the colour line. */
  readonly t: number;
  /** The colour there, unpremultiplied. */
  readonly color: ColourGlyphRgba;
}

/**
 * A colour as CSS, for a canvas.
 *
 * @param color - Channels 0..1, unpremultiplied.
 * @returns An `rgba()` string.
 */
export function cssColour(color: ColourGlyphRgba): string {
  const channel = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgba(${String(channel(color.r))}, ${String(channel(color.g))}, ${String(channel(color.b))}, ${String(Math.min(1, Math.max(0, color.a)))})`;
}

/**
 * The colour of a colour line at a parameter inside its stops' span.
 *
 * @param stops - The stops, in offset order, at least one.
 * @param t - The parameter, between the first and last offsets.
 * @returns The interpolated colour.
 */
function colourInside(stops: readonly ColourGlyphStop[], t: number): ColourGlyphRgba {
  const first = stops[0];
  if (first === undefined) return { r: 0, g: 0, b: 0, a: 0 };
  let before = first;
  for (const stop of stops) {
    if (stop.offset >= t) {
      const span = stop.offset - before.offset;
      const k = span <= 0 ? 1 : (t - before.offset) / span;
      const mix = (a: number, b: number): number => a + (b - a) * k;
      return {
        r: mix(before.color.r, stop.color.r),
        g: mix(before.color.g, stop.color.g),
        b: mix(before.color.b, stop.color.b),
        a: mix(before.color.a, stop.color.a),
      };
    }
    before = stop;
  }
  return before.color;
}

/**
 * The colour of a colour line at any parameter, by its extend mode.
 *
 * @param stops - The stops, in offset order, at least one.
 * @param extend - How the line continues past its stops.
 * @param t - The parameter.
 * @returns The colour.
 */
export function colourAt(
  stops: readonly ColourGlyphStop[],
  extend: ColourGlyphExtend,
  t: number,
): ColourGlyphRgba {
  const first = stops[0]?.offset ?? 0;
  const last = stops.at(-1)?.offset ?? 0;
  const span = last - first;
  if (extend === 'pad' || span <= 0) return colourInside(stops, Math.min(last, Math.max(first, t)));
  const period = Math.floor((t - first) / span);
  const within = t - first - period * span;
  const isMirrored = extend === 'reflect' && Math.abs(period) % 2 === 1;
  return colourInside(stops, first + (isMirrored ? span - within : within));
}

/**
 * The stops of a colour line over a parameter range: every stop (and, repeating, every tiled
 * stop) inside it with its own colour, and the colours at both ends. Sorted by t, stably, so
 * where two periods meet the earlier period's last stop comes before the next one's first: a
 * hard edge.
 *
 * @param stops - The colour line's stops, in offset order.
 * @param extend - How the line continues past its stops.
 * @param from - The range's start.
 * @param to - The range's end, past `from`.
 * @returns The stops.
 */
export function stopsOver(
  stops: readonly ColourGlyphStop[],
  extend: ColourGlyphExtend,
  from: number,
  to: number,
): ParamStop[] {
  const out: ParamStop[] = [{ t: from, color: colourAt(stops, extend, from) }];
  const first = stops[0]?.offset ?? 0;
  const span = (stops.at(-1)?.offset ?? 0) - first;
  const periods = extend === 'pad' || span <= 0 ? [0] : tilePeriods(from, to, first, span);
  for (const period of periods) {
    for (const stop of stops) {
      const offset = stop.offset - first;
      const isMirrored = extend === 'reflect' && Math.abs(period) % 2 === 1;
      const t = first + period * span + (isMirrored ? span - offset : offset);
      if (t > from && t < to) out.push({ t, color: stop.color });
    }
  }
  out.push({ t: to, color: colourAt(stops, extend, to) });
  return out.sort((a, b) => a.t - b.t);
}

/**
 * The periods of a repeating line that reach into a range.
 *
 * @param from - The range's start.
 * @param to - The range's end.
 * @param first - The first stop's offset.
 * @param span - The stops' span, positive.
 * @returns The period indices.
 */
function tilePeriods(from: number, to: number, first: number, span: number): number[] {
  const periods: number[] = [];
  const start = Math.floor((from - first) / span);
  const end = Math.ceil((to - first) / span);
  for (let period = start; period <= end; period += 1) periods.push(period);
  return periods;
}

/** The most periods a repeating line is written out for on either side of its stops. */
export const MAX_PERIODS = 2048;

/**
 * How many whole periods past its stops a repeating line must be written out, on its farther
 * side, to reach a range of parameters (one more than they need).
 *
 * @param stops - The colour line's stops, in offset order.
 * @param need - The lowest and highest parameters.
 * @returns The periods; 0 for a degenerate span, which never repeats.
 */
export function periodsNeeded(
  stops: readonly ColourGlyphStop[],
  need: readonly [number, number],
): number {
  const first = stops[0]?.offset ?? 0;
  const last = stops.at(-1)?.offset ?? 1;
  const span = last - first;
  if (span <= 0) return 0;
  const before = Math.ceil((first - need[0]) / span);
  const after = Math.ceil((need[1] - last) / span);
  return Math.max(0, before, after) + 1;
}

/**
 * The parameter range a gradient is written over: 0..1, widened to take any stop outside it, for
 * a padding line (a canvas pads past the ends itself); for repeat and reflect, the stops' span
 * widened by whole periods until it takes in the parameters the gradient must reach on the
 * canvas, one period more on each side and at most {@link MAX_PERIODS}, or by
 * {@link REPEAT_PERIODS} periods when that is not known.
 *
 * @param stops - The colour line's stops, in offset order.
 * @param extend - How the line continues past its stops.
 * @param need - The lowest and highest parameters the canvas shows, when known.
 * @returns The range; a degenerate span gives 0..1.
 */
export function paramRange(
  stops: readonly ColourGlyphStop[],
  extend: ColourGlyphExtend,
  need?: readonly [number, number],
): readonly [number, number] {
  const first = stops[0]?.offset ?? 0;
  const last = stops.at(-1)?.offset ?? 1;
  const span = last - first;
  if (span <= 0) return [0, 1];
  // Padding, stops inside 0..1 keep the gradient's own geometry; a canvas pads past its ends.
  if (extend === 'pad') return [Math.min(0, first), Math.max(1, last)];
  if (need === undefined) return [first - REPEAT_PERIODS * span, last + REPEAT_PERIODS * span];
  const periods = (distance: number): number =>
    Math.min(MAX_PERIODS, Math.max(0, Math.ceil(distance / span)) + 1);
  return [first - periods(first - need[0]) * span, last + periods(need[1] - last) * span];
}
