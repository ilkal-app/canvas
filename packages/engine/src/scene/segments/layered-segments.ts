import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import { LAYER_COMPOSITE_PASS_NAME } from '../layers/layer-composite-pass-name.js';
import type { Scene } from '../scene.js';

import { layerCandidatesOf, remeasureLayers, type LayerCandidates } from './layer-candidates.js';
import { boundsOfLayer, planLayeredDraws, type LayeredPlan } from './layer-planning.js';
import { LayeredPlanCache } from './layered-plan-cache.js';
import type { DrawnLayers } from './segment-layer-fallbacks.js';
import type { SegmentSpatialIndex } from './segment-moves.js';
import type { PlannedPass, SegmentPlanInput } from './segment-plan.js';
import type { SegmentRangeChanges } from './segment-removals.js';
import type { ZOrderMirror } from './z-order-mirror.js';

const NO_LAYERS: ReadonlyMap<ObjectId, readonly number[]> = new Map();

/**
 * The ranks where a pass's hidden table changed: every rank where it differs, or where either
 * hides something when the other is absent.
 *
 * @param was - The last plan's table.
 * @param now - This plan's.
 * @param ranks - Where the changed ranks go.
 */
function hiddenChanges(
  was: Uint8Array | undefined,
  now: Uint8Array | undefined,
  ranks: number[],
): void {
  if (was === now) return;
  const length = Math.max(was?.length ?? 0, now?.length ?? 0);
  const empty = new Uint8Array(length);
  const before = was ?? empty;
  const after = now ?? empty;
  for (let rank = 0; rank < length; rank += 1) if (before[rank] !== after[rank]) ranks.push(rank);
}

/**
 * The objects in layer form with their composite slot: the layer composite pass's slot entries,
 * or none for a scene without the pass.
 *
 * @param scene - The scene.
 * @returns The layers by object; live, read before the scene changes again.
 */
export function layerSlotsOf(scene: Scene): ReadonlyMap<ObjectId, readonly number[]> {
  return scene.passes.some(({ name }) => name === LAYER_COMPOSITE_PASS_NAME)
    ? scene.slotEntriesOf(LAYER_COMPOSITE_PASS_NAME)
    : NO_LAYERS;
}

/** The z-order segments' rank tables a layered plan reads. */
export interface LayeredRanks {
  /** Per paint rank, its object. */
  readonly paintOrder: readonly ObjectId[];
  /** Every object's own rank. */
  readonly rankById: ReadonlyMap<ObjectId, number>;
  /** Each closing rank by its object. */
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
  /** Each rank's slots in a pass, for patching the canvas plan. */
  readonly slotsOfRank?: (rank: number, passName: string) => readonly number[];
}

/**
 * The z-order segments' layer planning: plans frames with layers or objects at
 * opacity 0 (`planLayeredDraws`), measuring each layer by its members' boxes in the spatial
 * index (a frame's without its name, which draws on the canvas), and re-measures a kept plan's
 * layers when objects move. The frame's thread.
 */
export class LayeredSegments {
  /** The last measured candidates, kept while nothing they rest on changes. */
  private measured: LayerCandidates | undefined;
  /** Each window's last plan: only the windows that changed plan again. */
  private readonly cache = new LayeredPlanCache();
  /** The objects that changed since the last plan: their windows plan again. */
  private readonly changed = new Set<ObjectId>();
  /** The hidden tables the last plan was made with. */
  private hidden: readonly (Uint8Array | undefined)[] = [];

  /**
   * Creates the planner.
   *
   * @param mirror - The z-order segments' mirror: objects and those at opacity 0.
   * @param spatial - The culler's index, for boxes; without it layers cover the canvas.
   * @param rangeChangeOf - The culler's coverage changes, for planning only the windows whose
   *   records changed; without them every plan sorts every visible record.
   */
  constructor(
    private readonly mirror: ZOrderMirror,
    private readonly spatial: SegmentSpatialIndex | undefined,
    private readonly rangeChangeOf?: SegmentRangeChanges,
  ) {}

  /**
   * Plans a layered frame.
   *
   * @param scene - The scene, for its passes drawn outside layers.
   * @param input - The plain planner's input.
   * @param layerSlots - The layers' composite slots.
   * @param ranks - The paint order and rank tables.
   * @param drawn - The layers planned as if they were not (fallbacks), and the
   *   revision of that live set.
   * @returns The layered plan.
   */
  plan(
    scene: Scene,
    input: SegmentPlanInput,
    layerSlots: ReadonlyMap<ObjectId, readonly number[]>,
    ranks: LayeredRanks,
    drawn: Pick<DrawnLayers, 'excluded' | 'excludedRevision'>,
  ): LayeredPlan {
    const outside = scene.passes.filter((pass) => pass.isOutsideLayers === true);
    const memberBoundsOf = this.memberBoundsOf();
    const layerBounds = this.measured?.boundsById;
    const hiddenRanks = this.hiddenRanks(input.passes);
    const moved = [...this.mirror.withDescendants(this.changed)];
    this.changed.clear();
    const { spatial, rangeChangeOf } = this;
    return planLayeredDraws({
      ...(rangeChangeOf === undefined ? {} : { rangeChangeOf }),
      ...input,
      ...ranks,
      layerSlots,
      excludedLayers: drawn.excluded,
      excludedRevision: drawn.excludedRevision,
      cache: this.cache,
      moved,
      hiddenRanks,
      ...(spatial === undefined ? {} : { spatial }),
      ...(layerBounds === undefined ? {} : { layerBounds }),
      invisibleIds: this.mirror.invisibleIds,
      compositePassName: LAYER_COMPOSITE_PASS_NAME,
      outsidePassNames: new Set(outside.map(({ name }) => name)),
      ...(memberBoundsOf === undefined ? {} : { memberBoundsOf }),
    });
  }

  /**
   * The layers the frame may composite (`layerCandidatesOf`), measured from
   * scratch when `isStale` (the paint order, the slots, opacity 0 or a drawing bound changed),
   * else only the layers holding or held by the objects that moved (`remeasureLayers`). A camera
   * move measures nothing. The next {@link LayeredSegments.plan} reuses their bounds.
   *
   * @param isStale - Whether anything but positions changed since the last measure.
   * @param moved - The objects that changed since the last measure.
   * @param layerSlots - Every object in layer form with its composite slot.
   * @param ranks - The paint order and rank tables.
   * @returns The candidates.
   */
  candidates(
    isStale: boolean,
    moved: ReadonlySet<ObjectId>,
    layerSlots: ReadonlyMap<ObjectId, readonly number[]>,
    ranks: LayeredRanks,
  ): LayerCandidates {
    const { measured, mirror } = this;
    if (measured !== undefined && !isStale && moved.size === 0) return measured;
    const memberBoundsOf = this.memberBoundsOf();
    const input = {
      ...ranks,
      layerSlots,
      invisibleIds: mirror.invisibleIds,
      ...(memberBoundsOf === undefined ? {} : { memberBoundsOf }),
    };
    if (measured !== undefined && !isStale) {
      const parentOf = (id: ObjectId) => mirror.get(id)?.parentId;
      const partial = remeasureLayers(measured, input, moved, parentOf);
      if (partial !== undefined) return (this.measured = partial);
    }
    this.measured = layerCandidatesOf(input);
    return this.measured;
  }

  /**
   * Notes what changed this frame, before the mirror forgets it: a change every window rests on
   * (the paint order, slots, occluders, opacity 0, pages or drawing bounds, or no layer at all)
   * forgets every window's plan; changed objects make their windows plan again at the next plan.
   *
   * @param isStructural - Whether every window must plan again.
   * @param changed - The objects that changed.
   */
  observe(isStructural: boolean, changed: Iterable<ObjectId>): void {
    if (isStructural) {
      this.cache.clear();
      this.changed.clear();
      return;
    }
    for (const id of changed) this.changed.add(id);
  }

  /**
   * The ranks whose level-of-detail form changed in a pass since the last plan.
   *
   * @param passes - The passes, with this plan's hidden tables.
   * @returns The ranks.
   */
  private hiddenRanks(passes: readonly PlannedPass[]): number[] {
    const changed: number[] = [];
    passes.forEach(({ isHiddenByRank }, index) => {
      hiddenChanges(this.hidden[index], isHiddenByRank, changed);
    });
    this.hidden = passes.map(({ isHiddenByRank }) => isHiddenByRank);
    return changed;
  }

  /** Forgets the measured candidates: the board has no layer left. */
  forget(): void {
    this.measured = undefined;
  }

  /**
   * Re-measures a kept plan's layers after objects moved, in place.
   *
   * @param layered - The plan.
   * @param paintOrder - Its paint order.
   */
  refreshBounds(layered: LayeredPlan, paintOrder: readonly ObjectId[]): void {
    const memberBoundsOf = this.memberBoundsOf();
    if (memberBoundsOf === undefined) return;
    const input = { paintOrder, memberBoundsOf };
    const measured = this.measured?.boundsById;
    layered.layers.forEach((layer, index) => {
      const span = layered.spans[index];
      // This frame's measure when the layer has one, else measured here.
      const bounds = measured?.get(layer.id) ?? (span && boundsOfLayer(input, span));
      if (bounds) layered.layers[index] = { ...layer, bounds };
    });
  }

  /**
   * A layer member's box: a frame's without its drawing bounds (its name draws on the canvas).
   *
   * @returns The lookup, or undefined without a spatial index.
   */
  private memberBoundsOf(): ((id: ObjectId) => WorldBounds | undefined) | undefined {
    const { spatial, mirror } = this;
    if (spatial === undefined) return undefined;
    return (id) =>
      mirror.get(id)?.type === 'frame' && spatial.boundsWithoutDrawingOf
        ? spatial.boundsWithoutDrawingOf(id)
        : spatial.boundsOf(id);
  }
}
