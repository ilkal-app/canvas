import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';
import type { LayerDraw } from '../layers/layer-draw.js';

import { entriesOf } from './layer-buckets.js';
import { CANVAS_WINDOW } from './layer-reown.js';
import {
  compositesOf,
  structureOf,
  type LayerStructure,
  type PlanningLayer,
  type StructureInput,
} from './layer-structure.js';
import { canvasRanksOf, isCanvasPlanKept, windowChangesOf } from './layered-changes.js';
import type { CoverageInput } from './layered-coverage.js';
import {
  compositeChangeOf,
  isSameFrame,
  LayeredPlanCache,
  type PlannedWindow,
  type WindowRequest,
} from './layered-plan-cache.js';
import type { BoundsOfRank } from './segment-groups.js';
import type { SegmentSpatialIndex } from './segment-moves.js';
import {
  planSegmentDraws,
  type PlannedPass,
  type SegmentPlan,
  type SegmentPlanInput,
} from './segment-plan.js';
import { SegmentWindows } from './segment-windows.js';

export { boundsOfLayer, invisibleRanksOf } from './layer-structure.js';

/** What {@link planLayeredDraws} needs beyond the plain planner's input. */
export interface LayeredPlanInput extends StructureInput, CoverageInput {
  /** The passes, in registered order, with their level-of-detail hidden tables. */
  readonly passes: readonly PlannedPass[];
  /** Per paint rank, 1 for an occluder. */
  readonly isOccluderByRank: Uint8Array;
  /** Each rank's world box, as the plain planner takes it; omitted, merges by passes only. */
  readonly boundsOfRank?: BoundsOfRank;
  /**
   * The windows planned last time: a window whose inputs did not change, that holds
   * nothing in {@link LayeredPlanInput.moved} or {@link LayeredPlanInput.hiddenRanks} (the canvas:
   * nothing its plan's merges rested on) keeps its plan. Omitted, every window is planned.
   */
  readonly cache?: LayeredPlanCache;
  /** The objects that changed since the last plan, descendants included. */
  readonly moved?: Iterable<ObjectId>;
  /** Ranks whose level-of-detail form changed since the last plan. */
  readonly hiddenRanks?: Iterable<number>;
  /** The spatial index, for checking the canvas's kept plan against what moved. */
  readonly spatial?: SegmentSpatialIndex;
  /**
   * Each global rank's slots in a pass, for patching the canvas's plan as the culler's coverage
   * changes (`SegmentWindows`); omitted, or without `rangeChangeOf`, the canvas plans again.
   */
  readonly slotsOfRank?: (rank: number, passName: string) => readonly number[];
}

/** A layered plan: the frame's whole draw list, its canvas plan and its layers. */
export interface LayeredPlan {
  /** Layer windows' entries (tagged `layer`, innermost first), then the canvas plan's. */
  readonly entries: DrawListEntry[];
  /** The canvas plan: its tables are what moved objects are checked against. */
  readonly main: SegmentPlan;
  /** The layers with visible content, innermost first. */
  readonly layers: LayerDraw[];
  /** Each drawn layer's own and closing ranks, as `layers` lists them, for refreshing bounds. */
  readonly spans: readonly LayerSpan[];
  /** Whether any plan, the canvas's or a window's, merged by boxes. */
  readonly hasSpatialMerges: boolean;
}

/** A layer's paint ranks: its own and its closing one. */
export interface LayerSpan {
  /** Its own rank. */
  readonly open: number;
  /** Its closing rank, its composite's. */
  readonly close: number;
}

/** What {@link windowsOf} plans each window with. */
interface WindowPlanning {
  readonly input: LayeredPlanInput;
  readonly cache: LayeredPlanCache;
  readonly structure: LayerStructure;
  /** The plain planner's shared input: passes, occluders, boxes (layers' by their bounds). */
  readonly shared: Omit<SegmentPlanInput, 'visible'>;
}

/**
 * Plans the windows one by one, innermost first, then the canvas: a window keeps its last plan
 * when nothing in it changed (its records untouched by the culler's change, its composites,
 * bounds and ranks the same, no member moved or changed form); the canvas also when only
 * objects that do not break its merges moved, and it is patched by its interval cache when only
 * its coverage changed. Each layer's visibility is set as its window is planned.
 *
 * @param planning - The input, cache, structure and shared planner input.
 * @returns Each visible layer's window, then the canvas's (undefined when it draws nothing).
 */
function windowsOf(planning: WindowPlanning): {
  layerWindows: PlannedWindow[];
  canvas: PlannedWindow | undefined;
} {
  const { input, cache, structure, shared } = planning;
  const { layers, ownerOfRank, invisible } = structure;
  const { buckets, touched } = cache.coverage.update(input, structure);
  // Sorted afresh, the canvas's interval cache would miss this change.
  if (touched === undefined) cache.canvasWindows = undefined;
  const { dirty, canvasMoved } = windowChangesOf(input, ownerOfRank);
  const childrenOf = new Map<number, PlanningLayer[]>();
  for (const layer of layers) {
    const siblings = childrenOf.get(layer.parent);
    if (siblings === undefined) childrenOf.set(layer.parent, [layer]);
    else siblings.push(layer);
  }
  const isCanvasBroken = (composites: readonly WorldBounds[]): boolean => {
    const kept = cache.get(undefined);
    if (kept === undefined || canvasMoved.length === 0 || !kept.plan.hasSpatialMerges) return false;
    const { spatial } = input;
    if (spatial === undefined) return true;
    const ranks = canvasRanksOf(input, layers, ownerOfRank);
    return !isCanvasPlanKept({
      plan: kept.plan,
      moved: canvasMoved,
      composites,
      spatial,
      ...ranks,
    });
  };
  const windowOf = (index: number, layer: PlanningLayer | undefined): PlannedWindow | undefined => {
    const composites = compositesOf(childrenOf.get(index) ?? [], input.compositePassName);
    const frame = {
      childSlots: composites.slots,
      childBounds: composites.bounds,
      open: layer?.open ?? 0,
      close: layer?.close ?? -1,
    };
    if (dirty.has(index) || (index < 0 && isCanvasBroken(composites.bounds))) {
      cache.forget(layer?.id);
    }
    const key = layer?.id ?? CANVAS_WINDOW;
    const kept = cache.get(layer?.id);
    if (kept && touched && !touched.has(key) && isSameFrame(kept, frame) && layer) return kept;
    const visible = [...entriesOf(buckets.get(key)), ...composites.entries];
    if (visible.length === 0) return undefined;
    const request: WindowRequest = { ...frame, visible };
    if (layer === undefined) {
      const patched = touched && kept && patchCanvas(cache, input.compositePassName, kept, frame);
      if (patched) return cache.keep(undefined, request, patched);
    }
    const rankWindow =
      layer === undefined
        ? {}
        : { rankOffset: layer.open, rankCount: layer.close - layer.open + 1 };
    const planned = cache.window(layer?.id, request, () =>
      planSegmentDraws({ ...shared, visible, ...rankWindow }),
    );
    const { rangeChangeOf, slotsOfRank } = input;
    if (layer === undefined && cache.canvasWindows === undefined && rangeChangeOf && slotsOfRank) {
      const changes = cache.coverage.canvasChangeOf;
      const canvasInput = { ...shared, visible };
      cache.canvasWindows = new SegmentWindows(planned.plan, canvasInput, changes, slotsOfRank);
    }
    return planned;
  };
  const layerWindows: PlannedWindow[] = [];
  for (const layer of layers) {
    if (invisible[layer.open] === 1) continue;
    const window = windowOf(layer.index, layer);
    if (window === undefined || window.entries.length === 0) continue;
    layer.isVisible = true;
    layerWindows.push(window);
  }
  return { layerWindows, canvas: windowOf(-1, undefined) };
}

/**
 * The canvas's kept plan patched by its interval cache (`SegmentWindows`) for this update's
 * changes on the canvas: its records' coverage, the records that changed window with the
 * fallbacks, and the composites it draws (a child layer's composite added or removed; one whose
 * bounds changed is not patched). A refused patch drops the interval cache.
 *
 * @param cache - The cache, with the canvas's interval cache and coverage.
 * @param compositePassName - The composite pass's name.
 * @param kept - The canvas's kept window.
 * @param frame - The canvas's composites now.
 * @returns The patched plan, or undefined when the canvas must plan again.
 */
function patchCanvas(
  cache: LayeredPlanCache,
  compositePassName: string,
  kept: PlannedWindow,
  frame: Pick<WindowRequest, 'childSlots' | 'childBounds'>,
): SegmentPlan | undefined {
  const windows = cache.canvasWindows;
  if (windows === undefined) return undefined;
  const change = compositeChangeOf(kept, frame);
  if (change === undefined) return undefined;
  cache.coverage.noteCanvasChange(compositePassName, change.added, change.removed);
  const patched = windows.patch();
  // A refused patch leaves the interval cache unusable.
  if (patched === undefined) cache.canvasWindows = undefined;
  return patched;
}

/**
 * Plans a frame with layers. Each object in layer form owns the paint ranks from
 * its own to its closing one (its composite's); the visible records are sorted to the innermost
 * layer holding them, records of objects at opacity 0 (and everything under them) are left out,
 * frame names included, and passes drawn outside layers (frame names) stay on the canvas. Each
 * layer, innermost first, is planned as a rank window of its own (`planSegmentDraws` with
 * `rankOffset`), with the composites of its visible child layers in place of their content; a
 * layer whose window draws nothing is not visible, and neither is its composite. The canvas is
 * planned last, with the outermost visible layers' composites in place of their content; each
 * composite's rank takes the layer's bounds, so the composite is ordered as an occluder of that
 * box. With a cache, only the windows that changed plan again (`windowsOf`). Pure
 * apart from the cache.
 *
 * @param input - The tables, the visible records and the layers.
 * @returns The draw list and what it rests on.
 * @throws {RangeError} When a visible entry names no pass, or a plan's rank window is invalid.
 */
export function planLayeredDraws(input: LayeredPlanInput): LayeredPlan {
  const cache = input.cache ?? new LayeredPlanCache();
  const structure = structureOf(input, cache.structure);
  cache.structure = structure;
  const { layers } = structure;
  const boundsByRank = new Map<number, WorldBounds>();
  for (const layer of layers) if (layer.bounds) boundsByRank.set(layer.close, layer.bounds);
  // Read live: the canvas's interval cache plans parts again with this plan's layer bounds.
  cache.boundsByRank = boundsByRank;
  const base = input.boundsOfRank;
  const boundsOfRank: BoundsOfRank | undefined =
    base && ((rank) => cache.boundsByRank.get(rank) ?? base(rank));
  const shared = {
    passes: input.passes,
    isOccluderByRank: input.isOccluderByRank,
    ...(boundsOfRank === undefined ? {} : { boundsOfRank }),
  };
  cache.begin(base === undefined);
  const { layerWindows, canvas } = windowsOf({ input, cache, structure, shared });
  const entries: DrawListEntry[] = [];
  let hasSpatialMerges = false;
  for (const window of layerWindows) {
    hasSpatialMerges ||= window.plan.hasSpatialMerges;
    for (const entry of window.entries) entries.push(entry);
  }
  const main = canvas?.plan ?? planSegmentDraws({ ...shared, visible: [] });
  for (const entry of main.entries) entries.push(entry);
  // A layer left out of this plan is planned afresh when it returns: its members may move.
  const planned = new Set(layers.map(({ id }) => id));
  cache.retain((id) => planned.has(id));
  const drawn: LayerDraw[] = [];
  const spans: LayerSpan[] = [];
  for (const layer of layers) {
    if (!layer.isVisible || layer.bounds === undefined) continue;
    const parent = layers[layer.parent]?.id;
    drawn.push({ id: layer.id, slot: layer.slot, parent, bounds: layer.bounds });
    spans.push({ open: layer.open, close: layer.close });
  }
  hasSpatialMerges ||= main.hasSpatialMerges;
  return { entries, main, layers: drawn, spans, hasSpatialMerges };
}
