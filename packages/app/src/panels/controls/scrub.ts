/** How far the pointer moves, in CSS px, for a scrubbed number field to change by one step. */
export const SCRUB_PIXELS_PER_STEP = 2;

/** How many steps one scrub step makes while Shift is held (the design's "⇧ ×10"). */
export const SCRUB_COARSE_FACTOR = 10;

/** What {@link scrubValue} works from. */
export interface ScrubInput {
  /** The field's value when the drag started. */
  readonly start: number;
  /** How far the pointer has moved since then, in CSS px: right is positive. */
  readonly deltaPx: number;
  /** The field's step. */
  readonly step: number;
  /** The smallest value the field accepts. */
  readonly min: number;
  /** The largest value the field accepts. */
  readonly max: number;
  /** Whether Shift is held: each step is then {@link SCRUB_COARSE_FACTOR} steps. */
  readonly isCoarse: boolean;
}

/**
 * The number of decimals a step is written with (0.1 has one), so a scrubbed value is never
 * shown as 0.30000000000000004.
 *
 * @param step - The step.
 * @returns Its decimals, 0 for a whole step.
 */
function decimalsOf(step: number): number {
  const [, fraction = ''] = String(step).split('.');
  return fraction.length;
}

/**
 * The value a number field scrubs to (the design's "drag to scrub · ⇧ ×10"): the start plus
 * one step for every {@link SCRUB_PIXELS_PER_STEP} px the pointer moved (whole steps only, toward
 * the start), ten steps with Shift, within [`min`, `max`]. Measured from where the drag started,
 * so the same pointer position always gives the same value. Pure.
 *
 * @param input - The start, how far the pointer moved, the step, the bounds and Shift.
 * @returns The value.
 */
export function scrubValue(input: ScrubInput): number {
  const { start, deltaPx, step, min, max, isCoarse } = input;
  const steps = Math.trunc(deltaPx / SCRUB_PIXELS_PER_STEP);
  const change = steps * step * (isCoarse ? SCRUB_COARSE_FACTOR : 1);
  const bounded = Math.min(max, Math.max(min, start + change));
  return Number(bounded.toFixed(decimalsOf(step)));
}
