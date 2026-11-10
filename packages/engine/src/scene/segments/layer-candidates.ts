import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import type { LayerCandidate } from '../layers/layer-selection.js';

import {
  boundsOfLayer,
  invisibleRanksOf,
  type LayeredPlanInput,
  type LayerSpan,
} from './layer-planning.js';

/** What {@link layerCandidatesOf} reads: the paint order, the ranks and the layers. */
export type LayerCandidateInput = Pick<
  LayeredPlanInput,
  'paintOrder' | 'rankById' | 'closingRankById' | 'layerSlots' | 'invisibleIds' | 'memberBoundsOf'
>;

/** A layer's bounds where there are no boxes to measure: the whole plane. */
const EVERYWHERE: WorldBounds = {
  minX: Number.NEGATIVE_INFINITY,
  minY: Number.NEGATIVE_INFINITY,
  maxX: Number.POSITIVE_INFINITY,
  maxY: Number.POSITIVE_INFINITY,
};

/** How many ancestors a moved object's walk follows at most: past it, a corrupt chain stops. */
const MAX_DEPTH = 256;

/** Past this many moved objects in a frame, the layers are measured from scratch. */
const MAX_REMEASURED_MOVES = 64;

/** A measured layer: a candidate with its paint ranks, for measuring it again. */
export interface MeasuredLayer extends LayerCandidate {
  /** Its own and closing ranks. */
  readonly span: LayerSpan;
}

/** The layers a frame may composite, and their bounds by id for the plan. */
export interface LayerCandidates {
  /** Every layer with content, opacity 0 left out, in paint order (own ranks ascending). */
  readonly candidates: readonly MeasuredLayer[];
  /**
   * Each candidate's bounds by id (`LayeredPlanInput.layerBounds`); {@link remeasureLayers}
   * updates it in place, the measure it was made by being replaced.
   */
  readonly boundsById: Map<ObjectId, WorldBounds>;
  /**
   * The candidates' ids, in order: the same array while a re-measure keeps them
   * (`LayerSelection.select`'s layout).
   */
  readonly ids: readonly ObjectId[];
  /** Each candidate's index by id. */
  readonly indexById: ReadonlyMap<ObjectId, number>;
}

/**
 * The layers a frame may composite, for `LayerSelection`: every object in layer
 * form with a closing rank, its depth (how many such layers enclose it) and its bounds (the
 * union of its members' boxes, `boundsOfLayer`, or the whole plane without boxes); a layer whose
 * members have no box, and one at opacity 0 or inside one, draw nothing and are left out. Pure
 * apart from the reads.
 *
 * @param input - The paint order, ranks, layers and boxes.
 * @returns The candidates and their bounds.
 */
export function layerCandidatesOf(input: LayerCandidateInput): LayerCandidates {
  const spans: { id: ObjectId; open: number; close: number }[] = [];
  for (const id of input.layerSlots.keys()) {
    const open = input.rankById.get(id);
    const close = input.closingRankById.get(id);
    if (open !== undefined && close !== undefined) spans.push({ id, open, close });
  }
  spans.sort((a, b) => a.open - b.open);
  const invisible = input.invisibleIds.size > 0 ? invisibleRanksOf(input) : undefined;
  const candidates: MeasuredLayer[] = [];
  const boundsById = new Map<ObjectId, WorldBounds>();
  const enclosing: number[] = [];
  for (const span of spans) {
    while ((enclosing.at(-1) ?? Number.POSITIVE_INFINITY) < span.open) enclosing.pop();
    const depth = enclosing.length;
    enclosing.push(span.close);
    if (invisible?.[span.open] === 1) continue;
    const bounds = input.memberBoundsOf === undefined ? EVERYWHERE : boundsOfLayer(input, span);
    if (bounds === undefined) continue;
    boundsById.set(span.id, bounds);
    candidates.push({ id: span.id, depth, bounds, span: { open: span.open, close: span.close } });
  }
  const ids = candidates.map(({ id }) => id);
  return { candidates, boundsById, ids, indexById: new Map(ids.map((id, index) => [id, index])) };
}

/**
 * The first candidate whose own rank is above a rank: candidates are in paint order.
 *
 * @param candidates - The candidates.
 * @param rank - The rank.
 * @returns Its index, or the count when none is.
 */
function firstAbove(candidates: readonly MeasuredLayer[], rank: number): number {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const candidate = candidates[middle];
    if (candidate === undefined || candidate.span.open > rank) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The candidates again after objects moved and nothing else changed: only the
 * layers holding a moved object (its ancestors) or held by one (their ranks inside its own) are
 * measured again, so a drag costs its layers, not the board's. Pure apart from the reads.
 *
 * @param previous - The last measure, made on the same paint order.
 * @param input - The paint order, ranks and boxes.
 * @param moved - The objects that moved.
 * @param parentOf - Each object's parent, or null at the root.
 * @returns The candidates, or undefined when they must be measured from scratch: more than 64
 *   objects moved, or a layer had no box before or has none now.
 */
export function remeasureLayers(
  previous: LayerCandidates,
  input: LayerCandidateInput,
  moved: Iterable<ObjectId>,
  parentOf: (id: ObjectId) => ObjectId | null | undefined,
): LayerCandidates | undefined {
  const { memberBoundsOf } = input;
  if (memberBoundsOf === undefined) return previous; // Every layer covers the plane anyway.
  const movedIds = [...moved];
  if (movedIds.length > MAX_REMEASURED_MOVES) return undefined;
  const { indexById } = previous;
  const affected = new Map<number, MeasuredLayer>();
  for (const id of movedIds) {
    let at: ObjectId | null | undefined = id;
    for (let depth = 0; at && depth < MAX_DEPTH; depth += 1, at = parentOf(at)) {
      const index = indexById.get(at);
      // A layer that had no box to measure may have one now.
      if (index === undefined && input.layerSlots.has(at)) return undefined;
      const candidate = index === undefined ? undefined : previous.candidates[index];
      if (index !== undefined && candidate !== undefined) affected.set(index, candidate);
    }
    const open = input.rankById.get(id);
    const close = input.closingRankById.get(id);
    if (open === undefined || close === undefined) continue;
    // The layers inside it: their own ranks fall between its own and its closing one.
    for (let index = firstAbove(previous.candidates, open); ; index += 1) {
      const candidate = previous.candidates[index];
      if (candidate === undefined || candidate.span.open >= close) break;
      affected.set(index, candidate);
    }
  }
  if (affected.size === 0) return previous;
  const candidates = previous.candidates.slice();
  const { boundsById } = previous;
  for (const [index, candidate] of affected) {
    const bounds = boundsOfLayer({ paintOrder: input.paintOrder, memberBoundsOf }, candidate.span);
    if (bounds === undefined) return undefined;
    boundsById.set(candidate.id, bounds);
    candidates[index] = { ...candidate, bounds };
  }
  return { candidates, boundsById, ids: previous.ids, indexById };
}
