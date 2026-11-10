import type { WorldBounds } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import type { SnapGuide } from './snap-guide.js';

/** A line of a box along one axis: its low edge, its centre or its high edge. */
export type SnapEdge = 'min' | 'centre' | 'max';

/** Which of a box's lines snap on each axis: all three for a move, the dragged edge for a resize. */
export interface SnapEdges {
  /** The vertical lines: left edge, centre, right edge. */
  readonly x: readonly SnapEdge[];
  /** The horizontal lines: top edge, centre, bottom edge. */
  readonly y: readonly SnapEdge[];
}

/** The grid a box snaps to: lines every `spacing` world units through the world origin. */
export interface SnapGrid {
  /** The distance between grid lines, world units; greater than 0. */
  readonly spacing: number;
}

/** What snapping a box does: how far to move it, and the guides to draw once moved. */
export interface SnapResult {
  /** Add this to the box's position, world units; 0 on an axis that did not snap. */
  readonly delta: Point;
  /** A guide through each line the moved box shares with a candidate; none for the grid. */
  readonly guides: readonly SnapGuide[];
}

/** Every line on both axes: a move. */
export const ALL_SNAP_EDGES: SnapEdges = Object.freeze({
  x: Object.freeze(['min', 'centre', 'max'] as const),
  y: Object.freeze(['min', 'centre', 'max'] as const),
});

/**
 * How near a line must be, world units, to count as the same line when guides are collected:
 * far below a pixel at the deepest zoom, far above double-precision noise.
 */
const SAME_LINE_EPSILON = 1e-6;

type Axis = SnapGuide['axis'];

function lineOf(bounds: WorldBounds, axis: Axis, edge: SnapEdge): number {
  const min = axis === 'x' ? bounds.minX : bounds.minY;
  const max = axis === 'x' ? bounds.maxX : bounds.maxY;
  if (edge === 'min') return min;
  return edge === 'max' ? max : (min + max) / 2;
}

function spanOf(bounds: WorldBounds, axis: Axis): [number, number] {
  return axis === 'x' ? [bounds.minY, bounds.maxY] : [bounds.minX, bounds.maxX];
}

/**
 * The nearest offset, within the threshold, that puts one of the box's lines on one of the
 * candidates' lines (edges and centres); ties go to the first found.
 *
 * @param box - The dragged box.
 * @param candidates - The objects' boxes.
 * @param axis - The axis.
 * @param edges - The box's lines that snap on it.
 * @param threshold - The reach, world units.
 * @returns The offset, or undefined when no line is in reach.
 */
function objectOffset(
  box: WorldBounds,
  candidates: readonly WorldBounds[],
  axis: Axis,
  edges: readonly SnapEdge[],
  threshold: number,
): number | undefined {
  let best: number | undefined;
  for (const edge of edges) {
    const source = lineOf(box, axis, edge);
    // Allocation-free: a drag step may meet thousands of candidates (snap.bench.ts).
    for (const candidate of candidates) {
      const min = axis === 'x' ? candidate.minX : candidate.minY;
      const max = axis === 'x' ? candidate.maxX : candidate.maxY;
      for (let line = 0; line < 3; line += 1) {
        const offset = (line === 0 ? min : line === 1 ? (min + max) / 2 : max) - source;
        if (
          Math.abs(offset) <= threshold &&
          (best === undefined || Math.abs(offset) < Math.abs(best))
        )
          best = offset;
      }
    }
  }
  return best;
}

/**
 * The nearest offset, within the threshold, that puts one of the box's edges on a grid line.
 *
 * @param box - The dragged box.
 * @param grid - The grid.
 * @param axis - The axis.
 * @param edges - The box's lines that snap on it; its centre is skipped.
 * @param threshold - The reach, world units.
 * @returns The offset, or undefined when no grid line is in reach.
 */
function gridOffset(
  box: WorldBounds,
  grid: SnapGrid,
  axis: Axis,
  edges: readonly SnapEdge[],
  threshold: number,
): number | undefined {
  let best: number | undefined;
  // The grid snaps edges only: a centre on a dot would leave both edges between dots.
  for (const edge of edges.filter((name) => name !== 'centre')) {
    const source = lineOf(box, axis, edge);
    const offset = Math.round(source / grid.spacing) * grid.spacing - source;
    if (Math.abs(offset) <= threshold && (best === undefined || Math.abs(offset) < Math.abs(best)))
      best = offset;
  }
  return best;
}

function translated(box: WorldBounds, delta: Point): WorldBounds {
  return {
    minX: box.minX + delta.x,
    minY: box.minY + delta.y,
    maxX: box.maxX + delta.x,
    maxY: box.maxY + delta.y,
  };
}

function axisGuides(
  box: WorldBounds,
  candidates: readonly WorldBounds[],
  axis: Axis,
  edges: readonly SnapEdge[],
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  for (const edge of edges) {
    const position = lineOf(box, axis, edge);
    if (guides.some((guide) => Math.abs(guide.position - position) <= SAME_LINE_EPSILON)) continue;
    let [from, to] = spanOf(box, axis);
    let isOnLine = false;
    for (const candidate of candidates) {
      const isOnCandidate =
        Math.abs(lineOf(candidate, axis, 'min') - position) <= SAME_LINE_EPSILON ||
        Math.abs(lineOf(candidate, axis, 'centre') - position) <= SAME_LINE_EPSILON ||
        Math.abs(lineOf(candidate, axis, 'max') - position) <= SAME_LINE_EPSILON;
      if (!isOnCandidate) continue;
      isOnLine = true;
      const [low, high] = spanOf(candidate, axis);
      from = Math.min(from, low);
      to = Math.max(to, high);
    }
    if (isOnLine) guides.push({ axis, position, from, to });
  }
  return guides;
}

/**
 * The guides of a box as it stands: one through each of its given lines that lies on an edge
 * or centre of a candidate, spanning the box and every such candidate.
 * Pure.
 *
 * @param box - The box, world units.
 * @param candidates - The objects' boxes, world units.
 * @param edges - The box's lines to look at.
 * @returns The guides, vertical lines first.
 */
export function guidesOf(
  box: WorldBounds,
  candidates: readonly WorldBounds[],
  edges: SnapEdges,
): SnapGuide[] {
  return [
    ...axisGuides(box, candidates, 'x', edges.x),
    ...axisGuides(box, candidates, 'y', edges.y),
  ];
}

/**
 * Snaps a dragged box: on each axis, the nearest
 * offset within the threshold that puts one of the box's given lines (edges and centre) on an
 * edge or centre of a candidate; failing that, one of its edges on the grid, when there is
 * one. Objects win over the grid. The result moves the box by that offset and lists a guide
 * through each line the moved box then shares with a candidate (none for the grid). Pure; the
 * caller finds the candidates (`snapCandidatesNear`), and passes the threshold in world units
 * (`snapThresholdAt`), so it is 6 screen pixels at any zoom.
 *
 * @param box - The dragged box, world units.
 * @param candidates - Nearby objects' boxes, world units.
 * @param thresholdWorld - How near a line must be to snap, world units.
 * @param grid - The grid, when snapping to it; none if absent.
 * @param edges - The box's lines that snap; all of them (a move) if absent.
 * @returns The offset and the guides.
 */
export function snapBox(
  box: WorldBounds,
  candidates: readonly WorldBounds[],
  thresholdWorld: number,
  grid?: SnapGrid,
  edges: SnapEdges = ALL_SNAP_EDGES,
): SnapResult {
  const offsetOn = (axis: Axis, axisEdges: readonly SnapEdge[]): [number, boolean] => {
    const toObject = objectOffset(box, candidates, axis, axisEdges, thresholdWorld);
    if (toObject !== undefined) return [toObject, true];
    const toGrid = grid && gridOffset(box, grid, axis, axisEdges, thresholdWorld);
    return [toGrid ?? 0, false];
  };
  const [x, isObjectX] = offsetOn('x', edges.x);
  const [y, isObjectY] = offsetOn('y', edges.y);
  const delta = { x, y };
  const moved = translated(box, delta);
  return {
    delta,
    guides: guidesOf(moved, candidates, {
      x: isObjectX ? edges.x : [],
      y: isObjectY ? edges.y : [],
    }),
  };
}
