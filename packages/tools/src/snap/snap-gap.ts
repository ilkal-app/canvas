import type { WorldBounds } from '@canvas/engine';

/**
 * The space between a dragged box and its nearest neighbour on one side (the editing
 * states' "gap value"): a straight run across the gap, which the overlay draws as a red line with
 * a tick at each end and labels with its length.
 */
export interface SnapGap {
  /**
   * The axis the gap is measured along: `x` is a horizontal run from `from` to `to` at
   * `y = position`, `y` a vertical one at `x = position`.
   */
  readonly axis: 'x' | 'y';
  /** Where the run starts on its axis (the nearer edge of the lower object), world units. */
  readonly from: number;
  /** Where it ends (the facing edge of the higher object), world units; greater than `from`. */
  readonly to: number;
  /**
   * Where the run lies on the other axis, world units: the middle of the span the two objects
   * share across it.
   */
  readonly position: number;
}

/** Below this, world units, two edges touch: no gap is shown between them. */
const TOUCHING_EPSILON = 1e-6;

type Axis = SnapGap['axis'];

function lowOf(bounds: WorldBounds, axis: Axis): number {
  return axis === 'x' ? bounds.minX : bounds.minY;
}

function highOf(bounds: WorldBounds, axis: Axis): number {
  return axis === 'x' ? bounds.maxX : bounds.maxY;
}

/**
 * The span two boxes share across an axis (along y for an `x` gap), if they share one longer
 * than a point.
 *
 * @param box - One box.
 * @param other - The other.
 * @param axis - The axis the gap would be measured along.
 * @returns The shared span's ends, or undefined when the boxes do not face each other.
 */
function sharedSpan(
  box: WorldBounds,
  other: WorldBounds,
  axis: Axis,
): readonly [number, number] | undefined {
  const across: Axis = axis === 'x' ? 'y' : 'x';
  const low = Math.max(lowOf(box, across), lowOf(other, across));
  const high = Math.min(highOf(box, across), highOf(other, across));
  return high - low > TOUCHING_EPSILON ? [low, high] : undefined;
}

/**
 * The gaps on one axis: to the nearest candidate before the box and the nearest after it, among
 * those facing it (sharing a span across the axis) and clear of it.
 *
 * @param box - The dragged box.
 * @param candidates - The neighbours.
 * @param axis - The axis.
 * @returns Up to two gaps, before first.
 */
function axisGaps(box: WorldBounds, candidates: readonly WorldBounds[], axis: Axis): SnapGap[] {
  let before: { readonly edge: number; readonly span: readonly [number, number] } | undefined;
  let after: typeof before;
  const boxLow = lowOf(box, axis);
  const boxHigh = highOf(box, axis);
  for (const candidate of candidates) {
    const span = sharedSpan(box, candidate, axis);
    if (span === undefined) continue;
    const high = highOf(candidate, axis);
    const low = lowOf(candidate, axis);
    if (boxLow - high > TOUCHING_EPSILON && (before === undefined || high > before.edge))
      before = { edge: high, span };
    else if (low - boxHigh > TOUCHING_EPSILON && (after === undefined || low < after.edge))
      after = { edge: low, span };
  }
  const gaps: SnapGap[] = [];
  const middle = (span: readonly [number, number]): number => (span[0] + span[1]) / 2;
  if (before) gaps.push({ axis, from: before.edge, to: boxLow, position: middle(before.span) });
  if (after) gaps.push({ axis, from: boxHigh, to: after.edge, position: middle(after.span) });
  return gaps;
}

/**
 * The gaps around a dragged box (the editing states' red guides "with the gap value
 * between objects"): along each axis, the run from the box to its nearest neighbour on either
 * side, among the neighbours that face it (share a span across that axis longer than a point)
 * and do not touch or overlap it. A run lies at the middle of the span the two share. Pure: the
 * caller passes the same candidates snapping used (`snapCandidatesNear`), so the work is
 * O(candidates) per drag step.
 *
 * @param box - The dragged box as it lands, world units.
 * @param candidates - The neighbours' boxes, world units.
 * @returns At most four gaps: along x (before, after), then along y (before, after).
 */
export function gapsOf(box: WorldBounds, candidates: readonly WorldBounds[]): SnapGap[] {
  return [...axisGaps(box, candidates, 'x'), ...axisGaps(box, candidates, 'y')];
}

/**
 * A gap's length as its label shows it: whole world units, as the size readout shows sizes.
 *
 * @param gap - The gap.
 * @returns The rounded length, e.g. `24`.
 */
export function gapLabelOf(gap: SnapGap): string {
  return String(Math.round(gap.to - gap.from));
}
