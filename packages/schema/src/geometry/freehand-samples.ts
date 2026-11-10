import type { Point } from '../fields/point.js';
import { MAX_FREEHAND_POINTS } from '../objects/freehand-object.js';

// The draw tool's samples on their way to a stored stroke: the gesture's samples are
// smoothed (streamline), simplified (Ramer–Douglas–Peucker at a tolerance of half a screen pixel,
// so the stored points are as few as the drawing at that zoom needs), split at the per-object cap
// and packed into the flat arrays a freehand object stores.

/** One sample of a stroke: a point in the stroke's frame, and the pen pressure when known. */
export interface FreehandSample {
  /** The x coordinate, world units. */
  readonly x: number;
  /** The y coordinate, world units. */
  readonly y: number;
  /** The pen pressure from 0 to 1; absent when the device reports none. */
  readonly pressure?: number;
}

/** The simplification tolerance at 100% zoom: half a screen pixel, so the drop is invisible. */
export const FREEHAND_SIMPLIFY_PX = 0.5;

/** How far a sample's pressure may stray from its chord's before simplification keeps it. */
export const FREEHAND_PRESSURE_TOLERANCE = 0.05;

/**
 * The simplification tolerance at a zoom: {@link FREEHAND_SIMPLIFY_PX} screen pixels in world
 * units, so a stroke drawn zoomed in keeps its finer detail.
 *
 * @param zoom - The camera zoom, screen pixels per world unit.
 * @returns The tolerance, world units.
 * @throws {RangeError} When `zoom` is not a positive finite number.
 */
export function freehandTolerance(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError(`The zoom must be a positive finite number, not ${String(zoom)}.`);
  }
  return FREEHAND_SIMPLIFY_PX / zoom;
}

/**
 * A copy of one sample, its pressure kept only when present.
 *
 * @param sample - The sample.
 * @returns A new sample with the same values.
 */
function copyOf(sample: FreehandSample): FreehandSample {
  return sample.pressure === undefined
    ? { x: sample.x, y: sample.y }
    : { x: sample.x, y: sample.y, pressure: sample.pressure };
}

/**
 * The distance from a point to the segment between two others.
 *
 * @param point - The point.
 * @param from - The segment's start.
 * @param to - The segment's end.
 * @returns The distance, world units.
 */
function distanceToSegment(
  point: FreehandSample,
  from: FreehandSample,
  to: FreehandSample,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

/**
 * The samples without consecutive repeats of a position; a repeat's pressure is dropped.
 *
 * @param samples - The samples.
 * @returns The distinct runs' first samples, in order.
 */
function withoutRepeats(samples: readonly FreehandSample[]): FreehandSample[] {
  const kept: FreehandSample[] = [];
  for (const sample of samples) {
    const last = kept.at(-1);
    if (last?.x !== sample.x || last.y !== sample.y) kept.push(sample);
  }
  return kept;
}

/**
 * The sample at an index the caller knows is in range.
 *
 * @param samples - The samples.
 * @param index - The index, in range.
 * @returns The sample.
 * @throws {RangeError} When the index is out of range, which the callers never pass.
 */
function sampleAt(samples: readonly FreehandSample[], index: number): FreehandSample {
  const sample = samples[index];
  if (sample === undefined) throw new RangeError(`No sample at ${String(index)}.`);
  return sample;
}

/**
 * Whether a sample between two kept ones must be kept: too far from their chord, or, on a
 * pressured stroke, a pressure too far from the chord's interpolated pressure.
 *
 * @param samples - The samples.
 * @param first - The span's first index.
 * @param last - The span's last index.
 * @param index - The sample's index, inside the span.
 * @param tolerance - The distance tolerance, world units.
 * @returns How far past its tolerance the sample is (positive when it must be kept), relative.
 */
function excessOf(
  samples: readonly FreehandSample[],
  first: number,
  last: number,
  index: number,
  tolerance: number,
): number {
  const from = sampleAt(samples, first);
  const to = sampleAt(samples, last);
  const sample = sampleAt(samples, index);
  const distanceExcess = distanceToSegment(sample, from, to) - tolerance;
  if (sample.pressure === undefined || from.pressure === undefined || to.pressure === undefined) {
    return distanceExcess;
  }
  const along = (index - first) / (last - first);
  const expected = from.pressure + (to.pressure - from.pressure) * along;
  const pressureExcess = Math.abs(sample.pressure - expected) - FREEHAND_PRESSURE_TOLERANCE;
  return Math.max(distanceExcess, pressureExcess);
}

/**
 * Simplifies a stroke's samples by Ramer–Douglas–Peucker: the first and last samples stay, and a
 * span keeps its worst sample while that sample is farther than `tolerance` from the span's chord
 * or, when the samples carry pressure, its pressure differs from the chord's linearly
 * interpolated one by more than {@link FREEHAND_PRESSURE_TOLERANCE}. Consecutive repeats of a
 * position collapse to one sample first. Pure: returns new samples in input order.
 *
 * @param samples - The samples, in drawing order.
 * @param tolerance - The distance tolerance, world units ({@link freehandTolerance}).
 * @returns The kept samples; a copy for 0 or 1 samples.
 */
export function simplifyFreehand(
  samples: readonly FreehandSample[],
  tolerance: number,
): FreehandSample[] {
  const distinct = withoutRepeats(samples);
  if (distinct.length <= 2) return distinct.map(copyOf);
  const isKept = new Array<boolean>(distinct.length).fill(false);
  isKept[0] = true;
  isKept[distinct.length - 1] = true;
  const spans: [number, number][] = [[0, distinct.length - 1]];
  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [first, last] = span;
    let worst = -1;
    let worstExcess = 0;
    for (let index = first + 1; index < last; index += 1) {
      const excess = excessOf(distinct, first, last, index, tolerance);
      if (excess > worstExcess) {
        worst = index;
        worstExcess = excess;
      }
    }
    if (worst === -1) continue;
    isKept[worst] = true;
    spans.push([first, worst], [worst, last]);
  }
  return distinct.filter((sample, index) => isKept[index]).map(copyOf);
}

/**
 * Smooths a stroke's samples by streamlining: each output follows the previous output toward its
 * sample by `1 − factor`, on x, y and pressure, which damps the hand's jitter; the first and the
 * last output are the first and last samples, so the stroke ends where the pen lifted. Pure.
 *
 * @param samples - The samples, in drawing order.
 * @param factor - How strongly to smooth, in [0, 1); 0 returns an equal copy.
 * @returns The smoothed samples, one per sample.
 * @throws {RangeError} When `factor` is outside [0, 1).
 */
export function smoothFreehand(
  samples: readonly FreehandSample[],
  factor: number,
): FreehandSample[] {
  if (!(factor >= 0 && factor < 1)) {
    throw new RangeError(`The smoothing factor must be in [0, 1), not ${String(factor)}.`);
  }
  const follow = 1 - factor;
  const smoothed: FreehandSample[] = [];
  samples.forEach((sample, index) => {
    const previous = smoothed.at(-1);
    if (previous === undefined || index === samples.length - 1) {
      smoothed.push(copyOf(sample));
      return;
    }
    const x = previous.x + (sample.x - previous.x) * follow;
    const y = previous.y + (sample.y - previous.y) * follow;
    if (sample.pressure === undefined || previous.pressure === undefined) {
      smoothed.push(sample.pressure === undefined ? { x, y } : { x, y, pressure: sample.pressure });
      return;
    }
    smoothed.push({
      x,
      y,
      pressure: previous.pressure + (sample.pressure - previous.pressure) * follow,
    });
  });
  return smoothed;
}

/**
 * Splits a stroke's samples into pieces of at most `max` samples, for strokes longer than one
 * object stores. Each piece after the first starts with the previous piece's last sample, so the
 * drawn pieces join without a gap. Pure.
 *
 * @param samples - The samples, in drawing order.
 * @param max - The most samples per piece; {@link MAX_FREEHAND_POINTS} by default.
 * @returns The pieces, in order; one piece (a copy) when the stroke fits.
 * @throws {RangeError} When `max` is not an integer of at least 2.
 */
export function splitFreehand(
  samples: readonly FreehandSample[],
  max: number = MAX_FREEHAND_POINTS,
): FreehandSample[][] {
  if (!Number.isInteger(max) || max < 2) {
    throw new RangeError(`A piece holds at least 2 samples, not ${String(max)}.`);
  }
  if (samples.length <= max) return [samples.map(copyOf)];
  const pieces: FreehandSample[][] = [];
  for (let start = 0; start < samples.length - 1; start += max - 1) {
    pieces.push(samples.slice(start, start + max).map(copyOf));
  }
  return pieces;
}

/** The stored point data of a stroke: flat x, y pairs and, when known, one pressure per point. */
export interface FreehandFields {
  /** The flat x, y pairs, world units. */
  readonly points: number[];
  /** One pressure per point, 0 to 1; absent when any sample has none. */
  readonly pressures?: number[];
}

/**
 * Packs samples into a freehand object's stored arrays. Pressures are kept only when every
 * sample has one, since a stroke has pressure everywhere or nowhere. Pure.
 *
 * @param samples - The samples, in drawing order.
 * @returns The flat points and, when every sample has a pressure, the pressures.
 */
export function freehandFieldsOf(samples: readonly FreehandSample[]): FreehandFields {
  const points = samples.flatMap((sample) => [sample.x, sample.y]);
  const pressures = samples.flatMap((sample) =>
    sample.pressure === undefined ? [] : [sample.pressure],
  );
  return samples.length > 0 && pressures.length === samples.length
    ? { points, pressures }
    : { points };
}

/** A freehand object's stored arrays, as {@link freehandSamplesOf} reads them. */
export interface FreehandStoredFields {
  /** The flat x, y pairs. */
  readonly points: readonly number[];
  /** One pressure per point, or absent. */
  readonly pressures?: readonly number[] | undefined;
}

/**
 * A stroke's flat x, y pairs as points, in order; a trailing unpaired number is ignored. Pure.
 *
 * @param points - The flat pairs.
 * @returns One point per pair.
 */
export function freehandPointsOf(points: readonly number[]): Point[] {
  const result: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (x === undefined || y === undefined) break;
    result.push({ x, y });
  }
  return result;
}

/**
 * Unpacks a freehand object's stored arrays into samples; the inverse of
 * {@link freehandFieldsOf}. Pure.
 *
 * @param fields - The flat points and the optional pressures.
 * @returns One sample per point, with its pressure when the stroke has pressures.
 */
export function freehandSamplesOf(fields: FreehandStoredFields): FreehandSample[] {
  return freehandPointsOf(fields.points).map((point, index) => {
    const pressure = fields.pressures?.[index];
    return pressure === undefined ? point : { ...point, pressure };
  });
}
