import type { ObjectId } from '@canvas/schema';

import type { LodEntry, LodPassState } from './lod-pass-state.js';

/** A zoom's two scales, device pixels per world unit: the smaller and the larger. */
export interface LodZoom {
  /** The smaller scale. */
  readonly low: number;
  /** The larger scale. */
  readonly high: number;
}

/**
 * Visits the entries of a pass whose size on screen a zoom took across an edge of its rule
 * (`lodEdgesOf`): for each edge, the sizes from edge / high to edge / low, found by binary search
 * in the pass's sorted sizes and merged across edges so none is visited twice. When those sizes
 * hold more entries than there are visible objects (zoomed in on a large board), the visible
 * objects are walked instead, each tested against the edges, so the cost is the smaller of the
 * two. Either way exactly the crossing entries are visited, each once; the bucket walk
 * also visits crossing entries that are not visible, which the caller skips.
 *
 * @param state - The pass.
 * @param zoom - The zoom's scales.
 * @param visible - The visible objects, or undefined when every object is.
 * @param runs - Scratch space for the crossed ranges.
 * @param visit - Called with each crossing entry.
 * @returns How many entries were looked at.
 */
export function forEachCrossing(
  state: LodPassState,
  zoom: LodZoom,
  visible: ReadonlySet<ObjectId> | undefined,
  runs: number[],
  visit: (entry: LodEntry) => void,
): number {
  collectRuns(state, zoom, runs);
  if (runs.length === 0) return 0;
  if (visible !== undefined && visible.size < crossingCount(state, runs, visible.size)) {
    for (const id of visible) {
      const entry = state.entries.get(id);
      if (entry !== undefined && isCrossing(state.edges, entry.size, zoom)) visit(entry);
    }
    return visible.size;
  }
  let scanned = 0;
  for (let run = 0; run < runs.length; run += 2) {
    for (let index = runs[run] ?? 0; index < (runs[run + 1] ?? 0); index += 1) {
      const bucket = state.sizes.bucketAt(index);
      if (bucket === undefined) continue;
      scanned += bucket.size;
      for (const entry of bucket) visit(entry);
    }
  }
  return scanned;
}

/**
 * The ranges of a pass's sorted sizes a zoom took across an edge, merged, as start and end
 * pairs. Edges ascend, so each edge's range starts and ends no earlier than the last one's.
 *
 * @param state - The pass.
 * @param zoom - The zoom's scales.
 * @param runs - Emptied, then filled.
 */
function collectRuns(state: LodPassState, zoom: LodZoom, runs: number[]): void {
  const { low, high } = zoom;
  const { sizes, edges } = state;
  sizes.prepare();
  runs.length = 0;
  let runStart = 0;
  let runEnd = 0;
  for (const edge of edges) {
    const start = sizes.firstAtLeast(edge, high);
    const end = sizes.firstAtLeast(edge, low);
    if (start >= end) continue;
    if (start > runEnd) {
      if (runEnd > runStart) runs.push(runStart, runEnd);
      runStart = start;
    }
    runEnd = Math.max(runEnd, end);
  }
  if (runEnd > runStart) runs.push(runStart, runEnd);
}

/**
 * Whether a size is in a crossed range: on or above an edge at the larger scale and under it at
 * the smaller one, as `LodSizeIndex.firstAtLeast` tells them apart.
 *
 * @param edges - The rule's edges, device px.
 * @param size - The size, world units.
 * @param zoom - The zoom's scales.
 * @returns True when it crossed one.
 */
function isCrossing(edges: readonly number[], size: number, zoom: LodZoom): boolean {
  const { low, high } = zoom;
  for (const edge of edges) if (size * high >= edge && size * low < edge) return true;
  return false;
}

/**
 * How many entries the crossed ranges of a pass's sorted sizes hold, counted up to a limit.
 *
 * @param state - The pass.
 * @param runs - The ranges, start and end pairs.
 * @param limit - Where counting stops.
 * @returns The count, or the first count past the limit.
 */
function crossingCount(state: LodPassState, runs: readonly number[], limit: number): number {
  let count = 0;
  for (let run = 0; run < runs.length; run += 2) {
    for (let index = runs[run] ?? 0; index < (runs[run + 1] ?? 0); index += 1) {
      count += state.sizes.bucketAt(index)?.size ?? 0;
      if (count > limit) return count;
    }
  }
  return count;
}
