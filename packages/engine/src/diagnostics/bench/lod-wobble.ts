import {
  IMAGE_AVERAGE_COLOR_EDGE_PX,
  LOD_HYSTERESIS,
  PATH_CHORD_BOUNDS_PX,
  TEXT_GREEK_LINE_PX,
} from '../../lod/lod-thresholds.js';

import {
  centredCamera,
  type BenchPoint,
  type CameraLeg,
  type CameraViewport,
  type ZoomSweep,
} from './zoom-sweep.js';

/** A pinch that wobbles across one level-of-detail threshold. */
export interface LodWobble {
  /** Which rule's threshold. */
  readonly kind: 'text' | 'image' | 'path';
  /** The threshold, device px. */
  readonly thresholdPx: number;
  /** The scale at the pinch's widest, device px per world unit. */
  readonly lowScale: number;
  /** The scale at its closest: less than 1.2 × `lowScale`, so no size traverses a whole band. */
  readonly highScale: number;
}

/**
 * The wobbles of the zoom sweeps' wobble phase (fix round 1), sized for the synthetic
 * boards (`createLargeBoardObjects`): text lines are 20 units (16-unit type × 1.25), so 3.8 to
 * 4.3 px across the 4 px greek threshold; images are 120 to 180 units on the longer edge, so
 * those of 140 and 150 go across 8 px; paths and lines are 102 and 104 units, so 5.6 to 6.5 px
 * across 6 px. Each pinch spans less than the 20% band, so with the band an object changes form
 * at most once in it, and without one it flips at every swing (`lod-wobble.test.ts` pins both
 * against the boards).
 */
export const LOD_WOBBLES: readonly LodWobble[] = [
  { kind: 'text', thresholdPx: TEXT_GREEK_LINE_PX, lowScale: 0.19, highScale: 0.215 },
  { kind: 'path', thresholdPx: PATH_CHORD_BOUNDS_PX, lowScale: 0.055, highScale: 0.0625 },
  { kind: 'image', thresholdPx: IMAGE_AVERAGE_COLOR_EDGE_PX, lowScale: 0.052, highScale: 0.059 },
];

/** Round trips of each pinch: several, so a rule without a band flips again and again. */
export const WOBBLE_SWINGS = 4;

/** Legs of the wobble phase: two per swing, and a move to each pinch after the first. */
const WOBBLE_LEGS = LOD_WOBBLES.length * (1 + 2 * WOBBLE_SWINGS) - 1;

/**
 * How long the wobble phase runs for a sweep of a duration, ms: each leg a sixty-fourth of the
 * sweep (125 ms for the 8 s sweep, several frames per swing), so a smoke run's is short too.
 *
 * @param sweepMs - The sweep's duration, ms.
 * @returns The wobble phase's duration, ms.
 */
export function lodWobbleDurationMs(sweepMs: number): number {
  return (sweepMs / 64) * WOBBLE_LEGS;
}

/**
 * The wobble phase as camera moves about one centre: from the first of {@link LOD_WOBBLES}'s
 * widest scale, for each pinch {@link WOBBLE_SWINGS} round trips to its closest scale and back,
 * then a move to the next pinch's widest. Scales are
 * device px per world unit; the cameras' zooms divide by the viewport's `dpr`. Pure.
 *
 * @param centre - The world point the pinches zoom about.
 * @param viewport - The viewport.
 * @param sweepMs - The zoom sweep's duration, ms, which sets each leg's.
 * @returns The camera to start from and the legs.
 */
export function lodWobbleLegs(
  centre: BenchPoint,
  viewport: CameraViewport,
  sweepMs: number,
): ZoomSweep {
  const legMs = sweepMs / 64;
  const at = (scale: number): CameraLeg => ({
    camera: centredCamera(centre, scale / viewport.dpr, viewport),
    durationMs: legMs,
  });
  const legs: CameraLeg[] = [];
  for (const [index, { lowScale, highScale }] of LOD_WOBBLES.entries()) {
    if (index > 0) legs.push(at(lowScale));
    for (let swing = 0; swing < WOBBLE_SWINGS; swing += 1) legs.push(at(highScale), at(lowScale));
  }
  return { start: at(LOD_WOBBLES[0]?.lowScale ?? 1).camera, legs };
}

/**
 * Whether a pinch spans less than the 20% band ({@link LOD_HYSTERESIS}): then no size traverses
 * a whole band inside it. Pure.
 *
 * @param wobble - The pinch.
 * @returns True when narrower than the band.
 */
export function isInsideBand(wobble: LodWobble): boolean {
  return wobble.highScale < wobble.lowScale * (1 + LOD_HYSTERESIS);
}
