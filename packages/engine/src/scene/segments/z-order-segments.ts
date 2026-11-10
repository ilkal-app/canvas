import type { ObjectId } from '@canvas/schema';

import type { DrawListEntry } from '../draw-list.js';
import type { FrameContext, FrameStage } from '../frame-context.js';
import type { Frame } from '../frame.js';

import { slotsOfRank } from './closing-ranks.js';
import { copyDrawList, isSameDrawList } from './draw-list-snapshot.js';
import type { LayeredPlan } from './layer-planning.js';
import { LayeredSegments, layerSlotsOf, type LayeredRanks } from './layered-segments.js';
import { PaintOrderState, type ZOrderTables } from './paint-order-state.js';
import { plannedPassesOf } from './planned-passes.js';
import { wrapSegmentCollect } from './segment-collect.js';
import type { BoundsOfRank } from './segment-groups.js';
import { inlined, SegmentLayerFallbacks, type DrawnLayers } from './segment-layer-fallbacks.js';
import { verdictOfMoves, type MoveVerdict, type SegmentSpatialIndex } from './segment-moves.js';
import { planSegmentDraws, type SegmentPlan } from './segment-plan.js';
import type { SegmentRangeChanges } from './segment-removals.js';
import { SegmentTouches } from './segment-touches.js';
import { SegmentWindows, type SegmentWindowCounts } from './segment-windows.js';
import { SlotCompactor, type SlotCompactionOptions } from './slot-compactor.js';
import { SlotOwnerTable } from './slot-owner-table.js';
import { ZOrderMirror } from './z-order-mirror.js';
import type { SegmentRemovalCounts, ZOrderSegmentCounts } from './z-order-segment-counts.js';

/** The z-order segment stage's name; it runs right after `cull`. */
export const Z_ORDER_SEGMENTS_STAGE_NAME = 'zOrderSegments';

/** What a {@link ZOrderSegments} stage may read beyond the frame. */
export interface ZOrderSegmentsOptions {
  /**
   * The culler's spatial index (`SceneSpatialIndex`), for each object's world box, so occluders
   * that cover nothing drawn in a later pass before them share a segment, and for what a moved
   * object meets, so such a plan survives moves that break nothing. Omitted, every occluder
   * whose segment has content in a later pass than its own starts a new segment.
   */
  readonly spatial?: SegmentSpatialIndex;
  /** Optional precise cull deltas; unsupported or missed revisions use the full planner. */
  readonly rangeChangeOf?: SegmentRangeChanges;
  /** Re-slotting fragmented passes on still frames; `false` never re-slots. */
  readonly compaction?: SlotCompactionOptions | false | undefined;
}

export { DEFAULT_SLOT_COMPACTION, PAINT_ORDER_BATCH } from './slot-compactor.js';

/**
 * The most moved objects of a plan checked against it in one frame (`checkMovedObjects`): past
 * it (a whole selection dragged), the frame plans without boxes instead, which no move can make
 * wrong, and boxes return with the first frame in which nothing moves.
 */
export const MAX_CHECKED_MOVES = 256;

export type { SegmentRemovalCounts, ZOrderSegmentCounts } from './z-order-segment-counts.js';

export type { ZOrderTables } from './paint-order-state.js';

/**
 * Draws the board in z order (the prototype's segmented frame,
 * `webgl-whiteboard/src/render/renderer.ts`): a stage after `cull` that rewrites the frame's
 * draw list segment-major, a new segment at each visible opaque occluder, passes in registered
 * order within a segment (`planSegmentDraws`), so draw calls stay bounded by segments ×
 * passes (× atlas pages once text lands) rather than by object count.
 *
 * Given object boxes (`ZOrderSegmentsOptions.spatial`, the culler's index), an occluder that
 * covers nothing a later pass draws before it shares its segment, and records a pass
 * leaves out at this level of detail (`Scene.levelOfDetail`, the `hidden` form: text whose lines
 * would be under 2.5 device pixels) are left out of the plan, so a far view of many notes
 * is a few segments, not one per note.
 *
 * It keeps a `ZOrderMirror` of the document, fed by wrapping `collectChanges`, and caches
 * the paint order, the slot owners, the hidden records and the plan: a frame re-plans only when a
 * change set touched a `z` key, a parent, an occluder flag or a record count, when an object was
 * hidden or shown (`LevelOfDetail.hiddenRevision`), when the culler's visible ranges changed, or when a
 * moved object (or one under a moved frame) breaks a merge the plan made by boxes
 * (`checkMovedObjects`: an index search per moved object). Past {@link MAX_CHECKED_MOVES}
 * moved objects in a frame it plans by passes only, which no move can break, and by boxes again
 * in the first frame where nothing moves. A camera move with the same visible set re-plans
 * nothing. Consecutive cull deltas patch removals and repair complete old rank intervals for
 * additions; broad intervals, fragmentation or uncertain state plan in full; unaffected outer
 * segment boundaries stay conservative. Layers plan in full (`LayeredSegments`), less
 * those that fall back this frame (`SegmentLayerFallbacks`). `SceneRenderer` installs one.
 */
export class ZOrderSegments {
  /** The stage {@link ZOrderSegments.install} inserts after `cull`. */
  readonly stage: FrameStage;
  private readonly mirror = new ZOrderMirror();
  private readonly spatial: SegmentSpatialIndex | undefined;
  /** The tables indexed by paint rank (`PaintOrderState`). */
  private readonly paint = new PaintOrderState();
  private readonly slots = new SlotOwnerTable(); // Patched when only counts change.
  private plan: readonly DrawListEntry[] = [];
  private plannedFrom: readonly DrawListEntry[] | undefined;
  /** The page tables and drawing revision the plan was made with (what changed since). */
  private readonly touches: SegmentTouches;
  private rankSlots: ((rank: number, passName: string) => readonly number[]) | undefined;
  /** The last plan's tables, for checking moved objects against it. */
  private lastPlan: SegmentPlan | undefined;
  /** Whether the plan was made without boxes because too many objects moved. */
  private isPlannedWithoutBoxes = false;
  private plans = 0;
  private readonly rangeChangeOf: SegmentRangeChanges | undefined;
  private windows: SegmentWindows | undefined;
  private removalPatches = 0;
  private removalSlotReads = 0;
  /** The last plan's layers, when it had any (or objects at opacity 0). */
  private layered: LayeredPlan | undefined;
  private readonly layers: LayeredSegments;
  /** Which layers composite this frame and which fall back. */
  private readonly fallbacks: SegmentLayerFallbacks;
  private readonly compactor: SlotCompactor;
  /**
   * Creates the stage; call {@link ZOrderSegments.install} before the scene applies a change.
   *
   * @param options - The spatial index; without it segments merge by passes only.
   */
  constructor(options: ZOrderSegmentsOptions = {}) {
    this.spatial = options.spatial;
    this.touches = new SegmentTouches(options.spatial);
    this.layers = new LayeredSegments(this.mirror, options.spatial, options.rangeChangeOf);
    this.fallbacks = new SegmentLayerFallbacks(this.layers, this.mirror, () => this.layeredRanks());
    this.rangeChangeOf = options.rangeChangeOf;
    this.compactor = new SlotCompactor(options.compaction, this.slots, () => this.layeredRanks());
    this.stage = {
      name: Z_ORDER_SEGMENTS_STAGE_NAME,
      run: (context) => {
        this.segment(context);
        this.compactor.notePlan(
          this.plan,
          (name) => context.scene.instanceBufferOf(name).recordCount,
        );
      },
    };
  }

  /**
   * How often each cached table was rebuilt, for tests and diagnostics.
   *
   * @returns The counts so far.
   */
  get counts(): ZOrderSegmentCounts {
    const { paint, plans, slots, compactor } = this;
    return {
      orderBuilds: paint.builds,
      orderEdits: paint.edits,
      slotBuilds: slots.builds,
      plans,
      slotCompactions: compactor.recordCount,
    };
  }

  /**
   * Whether a pass drawn fragmented still waits to be re-slotted (`SlotCompactor`).
   *
   * @returns True while one does.
   */
  hasPendingCompaction(): boolean {
    return this.compactor.hasPending();
  }

  /**
   * How many frames patched the slot-owner tables instead of rebuilding them: those
   * where only existing objects' record counts changed.
   *
   * @returns The count so far.
   */
  get slotPatchCount(): number {
    return this.slots.patches;
  }

  /**
   * Interval patches and logical slot visits, excluding full-plan construction.
   *
   * @returns The incremental work counters.
   */
  get removalCounts(): SegmentRemovalCounts {
    return { patches: this.removalPatches, slotReads: this.removalSlotReads };
  }

  /**
   * Current interval cache's work counters; resets when a full plan replaces the cache.
   *
   * @returns A copied snapshot, or undefined without precise cull deltas.
   */
  get windowCounts(): SegmentWindowCounts | undefined {
    return this.windows?.counts;
  }

  /**
   * How many segments the last plan drew, for tests and diagnostics.
   *
   * @returns The count; 0 before the first plan.
   */
  get segmentCount(): number {
    return this.lastPlan?.segmentCount ?? 0;
  }

  /**
   * Hooks into a frame: wraps `collectChanges` so every change set reaches the mirror, and
   * inserts the stage after `cull`. Install before the first frame applies a change set: an
   * object the mirror never saw would have no rank, and the stage refuses to draw without one.
   *
   * @param frame - A frame with `collectChanges` and `cull` stages.
   * @throws {RangeError} When the frame lacks either stage or already has this one.
   */
  install(frame: Frame): void {
    frame.insertStage('after', 'cull', this.stage);
    wrapSegmentCollect(frame, {
      mirror: this.mirror,
      slots: this.slots,
      compactor: this.compactor,
    });
  }

  private segment(context: FrameContext): void {
    const { scene, drawList } = context;
    if (this.mirror.objectCount !== scene.objectCount) {
      throw new Error(
        `Z-order segments saw ${String(this.mirror.objectCount)} objects but the scene has ${String(scene.objectCount)}: install ZOrderSegments before the first change set is applied.`,
      );
    }
    const { isOccludersDirty, isSlotsDirty } = this.mirror;
    const { isOrderDirty, isHiddenDirty } = this.paint.refresh(scene, this.mirror, this.slots);
    const isCompacted = this.compactor.refresh(scene, isOrderDirty, isSlotsDirty);
    const isBoundsDirty = this.touches.isDirty(scene);
    const layerSlots = layerSlotsOf(scene);
    const isLayered = layerSlots.size > 0 || this.mirror.invisibleIds.size > 0;
    const drawnLayers = this.fallbacks.choose(context, layerSlots, isBoundsDirty);
    const isStructural =
      drawnLayers.isChanged ||
      this.mirror.isVisibilityDirty ||
      isLayered !== (this.layered !== undefined) ||
      isOrderDirty ||
      isOccludersDirty ||
      isSlotsDirty ||
      isCompacted ||
      !this.plannedFrom;
    // A page, drawing-box or hidden change patches the records it touches.
    const isTouched = isBoundsDirty || isHiddenDirty;
    const isKnown = !isStructural && isTouched;
    const touched = isKnown
      ? this.touches.collect(scene, drawList, this.paint.hiddenByRank, this.rankSlots)
      : undefined;
    const isTableDirty = isStructural || (isTouched && touched === undefined);
    const isCoverageChanged = !this.plannedFrom || !isSameDrawList(this.plannedFrom, drawList);
    const isTableStale = isTableDirty || isCoverageChanged || isTouched;
    const canPatch =
      !isTableDirty &&
      (isCoverageChanged || isTouched) &&
      this.mirror.updatedIds.size === 0 &&
      !this.isPlannedWithoutBoxes &&
      !isLayered;
    const moves = isTableStale ? 'kept' : this.movesVerdict();
    const hasMoved = this.mirror.updatedIds.size > 0;
    this.mirror.clearDirty();
    if (isTableStale || moves !== 'kept') {
      this.touches.planned(scene, this.paint.hiddenByRank);
      const beforeReads = this.windows?.counts.slotReads ?? 0;
      const hidden = isHiddenDirty ? this.paint.hiddenByRank : undefined;
      const patched = canPatch ? this.windows?.patch(touched, hidden) : undefined;
      if (patched) {
        this.lastPlan = patched;
        this.plan = patched.entries;
        this.plannedFrom = copyDrawList(drawList);
        this.removalPatches += 1;
        this.removalSlotReads += (this.windows?.counts.slotReads ?? 0) - beforeReads;
      } else
        this.replan(context, moves === 'tooMany', isLayered ? layerSlots : undefined, drawnLayers);
    } else if (this.layered && hasMoved)
      this.layers.refreshBounds(this.layered, this.paint.order.paintOrder);
    else this.windows?.observe();
    drawList.splice(0, drawList.length, ...this.plan);
    context.layers.splice(0, context.layers.length, ...inlined(this.layered, drawnLayers.inline));
    context.stats.segments = this.segmentCount;
  }

  /**
   * What this frame's moves do to the plan (`verdictOfMoves`).
   *
   * @returns `kept`, `broken` or `tooMany`.
   */
  private movesVerdict(): MoveVerdict {
    return verdictOfMoves(
      {
        spatial: this.spatial,
        lastPlan: this.lastPlan,
        layered: this.layered,
        isPlannedWithoutBoxes: this.isPlannedWithoutBoxes,
        moved: this.mirror.updatedIds,
        descendants: (ids) => this.mirror.withDescendants(ids),
        ranks: () => this.paint.ranks(),
        closingRanks: () => this.paint.closingRankById,
      },
      MAX_CHECKED_MOVES,
    );
  }

  /**
   * The paint order and rank tables a layered plan reads.
   *
   * @returns The ranks.
   */
  private layeredRanks(): LayeredRanks {
    const rankById = this.paint.ranks();
    const { closingRankById } = this.paint;
    return { paintOrder: this.paint.order.paintOrder, rankById, closingRankById };
  }

  /**
   * Plans the frame's draw list from the cached tables and the culler's draw list.
   *
   * @param context - The frame.
   * @param isWithoutBoxes - Whether to merge by passes only (too many objects are moving).
   * @param layerSlots - The layers' composite slots, for a layered plan.
   * @param drawn - The layers the plan leaves out this frame.
   */
  private replan(
    context: FrameContext,
    isWithoutBoxes: boolean,
    layerSlots: ReadonlyMap<ObjectId, readonly number[]> | undefined,
    drawn: DrawnLayers,
  ): void {
    const { scene, drawList } = context;
    this.plannedFrom = copyDrawList(drawList);
    const { paintOrder, isClosingRank, isOccluderByRank } = this.paint.order;
    const spatial = isWithoutBoxes ? undefined : this.spatial;
    const boundsOfRank: BoundsOfRank | undefined =
      spatial === undefined
        ? undefined
        : (rank) => {
            // Only ranks of this paint order; a moving leaf has none: meets all.
            const id = paintOrder[rank];
            return id === undefined || spatial.isMoving?.(id) ? undefined : spatial.boundsOf(id);
          };
    const passes = plannedPassesOf(scene, this.slots.tables, this.paint.hiddenByRank);
    const input = {
      passes,
      isOccluderByRank,
      visible: drawList,
      ...(boundsOfRank === undefined ? {} : { boundsOfRank }),
    };
    this.isPlannedWithoutBoxes = isWithoutBoxes && this.spatial !== undefined;
    this.plans += 1;
    const slots = slotsOfRank(scene, paintOrder, isClosingRank, this.paint.closingRankById);
    this.rankSlots = slots;
    const ranks = { ...this.layeredRanks(), slotsOfRank: slots };
    this.layered = layerSlots && this.layers.plan(scene, input, layerSlots, ranks, drawn);
    if (this.layered) {
      // The layered planner keeps its own interval cache, for the canvas.
      this.windows = undefined;
      this.plan = this.layered.entries;
      this.lastPlan = this.layered.main;
      return;
    }
    const plan = planSegmentDraws(input);
    this.plan = plan.entries;
    this.lastPlan = plan;
    this.windows = this.rangeChangeOf && new SegmentWindows(plan, input, this.rangeChangeOf, slots);
  }

  /**
   * The tables as they stand, for tests and diagnostics (an edited order's tables equal
   * a walk's): live views, never to be mutated. Builds the rank indexes when they are not.
   *
   * @returns The tables.
   */
  tables(): ZOrderTables {
    const { paintOrder, isClosingRank, isOccluderByRank } = this.paint.order;
    const rankById = this.paint.ranks();
    const { closingRankById, hiddenByRank } = this.paint;
    return {
      paintOrder,
      isClosingRank,
      isOccluderByRank,
      rankById,
      closingRankById,
      hiddenByRank,
      slotOwners: this.slots.tables,
    };
  }
}
