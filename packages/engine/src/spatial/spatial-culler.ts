import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { Frame } from '../scene/frame.js';
import type { CullRangeChange, InstanceRange, SceneCuller } from '../scene/scene-culler.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import type { Scene } from '../scene/scene.js';

import { intersectsBounds } from './bounds.js';
import { IncrementalVisibleRanges } from './incremental-visible-ranges.js';
import { isQueryReusable, padViewport } from './padded-viewport.js';
import { SceneSpatialIndex, type IndexedBoxChange } from './scene-spatial-index.js';
import { SpatialVisibility, type VisibilityChange } from './spatial-visibility.js';
import { VisibleRangeTables } from './visible-range-tables.js';

/** Options for a {@link SpatialCuller}. */
export interface SpatialCullerOptions {
  /**
   * How far the query reaches past the viewport on each side, as a fraction of the viewport's
   * size; pans within it reuse the last query. Default 0.25.
   */
  readonly paddingFraction?: number;
  /**
   * The longest run of hidden records drawn through to save a draw call (see `visibleRanges`).
   * Default 16.
   */
  readonly maxGapRecords?: number;
  /** The index to keep; pass one to share it with hit testing. Default: a new, empty index. */
  readonly index?: SceneSpatialIndex;
  /**
   * How visible ranges are kept as the view changes: `'tables'` (the default) patches
   * each pass in typed tables by dense object handle and publishes whole-board views from the
   * reference without patching; `'reference'` is the earlier per-object map path, kept while the
   * two are compared.
   */
  readonly rangeCache?: 'tables' | 'reference';
  /**
   * The most visible-set entries and exits one frame applies: carried ones first, then
   * entries nearest the viewport's centre first (viewport entries before padding-only ones,
   *), exits last, and the rest in later frames (`hasPendingAdmissions`). An integer of at
   * least 1, or `Infinity` (the default) for no cap; under a cap the culler always draws by
   * membership, never whole buffers. Installed in a frame, the culler admits once per frame
   * however often the frame asks for visibility.
   */
  readonly entriesPerFrame?: number | undefined;
}

const DEFAULT_PADDING_FRACTION = 0.25;
const DEFAULT_MAX_GAP_RECORDS = 16;

/**
 * The R-tree culler: the
 * `SceneRenderer`'s default {@link SceneCuller}. It keeps a {@link SceneSpatialIndex} in step
 * with the scene (the renderer feeds it every change set it applies, through
 * {@link SpatialCuller.install}) and answers each frame's cull from R-tree queries
 * of the viewport padded by `paddingFraction`. The query region and the ranges built from it are
 * kept, and the tree is searched again only when they may be wrong:
 *
 * - a frame whose viewport stays inside the padded region (and has not zoomed in more than
 *   twofold) keeps the region, so a small pan or zoom searches nothing;
 * - a document change that moves an object's box into or out of the region updates the same
 *   region by updating that ID directly;
 * - an object that changes but stays inside keeps its slots unless its record count changed,
 *   so the ranges are rebuilt only when it holds a slot they do not draw; a still frame, a small
 *   pan and a drag inside the view return the same ranges object.
 *
 * {@link SpatialCuller.queryCount} counts logical visibility refreshes.
 *
 * Objects the index does not hold (groups, comments) are never drawn unless the
 * whole board is visible; objects clipped away entirely never are, since the whole
 * board counts as visible only while there are none. Main thread or the engine worker, beside its scene.
 */
export class SpatialCuller implements SceneCuller {
  /** The index this culler keeps; hit testing and marquee selection may query it. */
  readonly index: SceneSpatialIndex;
  private readonly paddingFraction: number;
  private query: WorldBounds | undefined;
  private readonly visibility = new SpatialVisibility();
  private visibilityChange: VisibilityChange | undefined;
  private readonly changedMembershipIds = new Set<ObjectId>();
  /** Whether `visibleIds` must be searched again (the region moved, or a box entered or left it). */
  private isSearchStale = true;
  private readonly rangeCache: IncrementalVisibleRanges | VisibleRangeTables;
  private readonly changedSlotIds = new Set<ObjectId>();
  private queries = 0;
  private isCollectingChanges = false;
  private readonly entriesPerFrame: number;
  private isInstalled = false;
  /** Whether a carried admission may advance: once per installed frame, else on every ask. */
  private canAdmit = true;

  /**
   * Creates a culler with an empty index, or the given one.
   *
   * @param options - Padding, gap bridging and the index.
   * @throws {RangeError} When `paddingFraction` is negative or not finite, `maxGapRecords` is
   *   not a whole number of at least 0, or `entriesPerFrame` is neither an integer of at least 1
   *   nor Infinity.
   */
  constructor(options: SpatialCullerOptions = {}) {
    const paddingFraction = options.paddingFraction ?? DEFAULT_PADDING_FRACTION;
    if (!Number.isFinite(paddingFraction) || paddingFraction < 0) {
      throw new RangeError(
        `paddingFraction must be finite and ≥ 0; got ${String(paddingFraction)}.`,
      );
    }
    const maxGapRecords = options.maxGapRecords ?? DEFAULT_MAX_GAP_RECORDS;
    if (!Number.isInteger(maxGapRecords) || maxGapRecords < 0) {
      throw new RangeError(`maxGapRecords must be an integer ≥ 0; got ${String(maxGapRecords)}.`);
    }
    const entriesPerFrame = options.entriesPerFrame ?? Infinity;
    if (
      entriesPerFrame !== Infinity &&
      !(Number.isInteger(entriesPerFrame) && entriesPerFrame >= 1)
    ) {
      throw new RangeError(
        `entriesPerFrame must be an integer ≥ 1 or Infinity; got ${String(entriesPerFrame)}.`,
      );
    }
    this.entriesPerFrame = entriesPerFrame;
    this.paddingFraction = paddingFraction;
    this.rangeCache =
      options.rangeCache === 'reference'
        ? new IncrementalVisibleRanges(maxGapRecords)
        : new VisibleRangeTables(maxGapRecords);
    this.index = options.index ?? new SceneSpatialIndex();
  }

  /**
   * How many logical visibility refreshes culling has made: one when the viewport left the last
   * padded region, and one for each frame after an object entered or left it. For tests and the
   * frame-time overlay. A refresh may search several strips or update changed IDs without a search.
   *
   * @returns The count since the culler was created.
   */
  get queryCount(): number {
    return this.queries;
  }

  /**
   * Brings the index up to date with a change set the scene has applied, and notes what it did
   * to the visible set (the indexed objects whose boxes meet the last query's region): an object
   * whose box entered or left the region changes the set; one that stayed inside may have new
   * slots.
   *
   * @param changes - The change set, as the scene applied it; not mutated.
   */
  applyChanges(changes: SceneChangeSet): void {
    this.apply(changes, false);
  }

  private apply(changes: SceneChangeSet, isSlotOwnershipUnchanged: boolean): void {
    this.index.applyInto(changes, (id, previous, next) => {
      if (!isSlotOwnershipUnchanged) this.changedSlotIds.add(id);
      this.noteBoundsChange(id, previous, next);
    });
  }

  /**
   * Updates asynchronous text bounds and invalidates cached visibility when needed.
   *
   * @param id - The object.
   * @param bounds - Its text drawing bounds, or undefined after removal.
   */
  setDrawingBounds(id: ObjectId, bounds: WorldBounds | undefined): void {
    const change = this.index.setDrawingBounds(id, bounds, !this.isCollectingChanges);
    // During collection, applyChanges indexes the new geometry and supplement together.
    if (!this.isCollectingChanges) this.noteBoundsChanges([[id, change]]);
  }

  private noteBoundsChanges(changes: Iterable<readonly [ObjectId, IndexedBoxChange]>): void {
    for (const [id, { previous, next }] of changes) this.noteBoundsChange(id, previous, next);
  }

  private noteBoundsChange(
    id: ObjectId,
    previous: WorldBounds | undefined,
    next: WorldBounds | undefined,
  ): void {
    const { query } = this;
    if (!query) return;
    const wasVisible = previous !== undefined && intersectsBounds(previous, query);
    const isVisible = next !== undefined && intersectsBounds(next, query);
    if (wasVisible !== isVisible) {
      this.isSearchStale = true;
      this.changedMembershipIds.add(id);
    }
  }

  /**
   * Takes root leaves a retained move places out of the index's tree: their boxes
   * follow {@link SpatialCuller.moveRetained}, so a drag frame re-indexes nothing.
   *
   * @param ids - The moving root leaves, in placement order.
   * @param positions - Their positions now, `x, y` per object.
   */
  beginRetained(ids: readonly ObjectId[], positions: Float64Array): void {
    this.index.beginMoving(ids, positions);
  }

  /**
   * Moves the retained root leaves, noting each that enters or leaves the culled region.
   *
   * @param positions - Their positions now, `x, y` per object.
   */
  moveRetained(positions: Float64Array): void {
    const flipped = this.index.moveMoving(positions, this.query);
    for (const id of flipped) this.changedMembershipIds.add(id);
    if (flipped.length > 0) this.isSearchStale = true;
  }

  /**
   * Moves the retained root leaves by one shared displacement from where `moveRetained` last
   * put them (a translating drag), noting each that enters or leaves the culled region.
   *
   * @param dx - The displacement along x.
   * @param dy - Along y.
   */
  translateRetained(dx: number, dy: number): void {
    const flipped = this.index.moveMoving([dx, dy], this.query);
    for (const id of flipped) this.changedMembershipIds.add(id);
    if (flipped.length > 0) this.isSearchStale = true;
  }

  /** Puts the retained root leaves back in the index's tree, where they are now. */
  endRetained(): void {
    this.index.endMoving();
  }

  /**
   * Finds the records to draw: the slots of every object whose box meets the padded viewport,
   * coalesced into ranges per pass.
   *
   * @param scene - The scene the culler's index mirrors.
   * @param viewport - The world rectangle the camera shows.
   * @returns The ranges per pass name; the same map as last frame when nothing it depends on
   *   changed.
   */
  cull(scene: Scene, viewport: WorldBounds): ReadonlyMap<string, readonly InstanceRange[]> {
    const visibility = this.visibilityFor(viewport);
    const ranges = this.rangeCache.update(
      scene,
      visibility,
      this.changedSlotIds,
      // Clipped-away objects are not indexed but hold slots: drawing whole buffers would draw
      // them (to nothing, the GPU clips them), so they are skipped by drawing by membership.
      // Carried admissions mean the drawn set is not yet the query's.
      // Under a budget, never: the switch drops the ranges' deltas, and z-order re-plans.
      this.entriesPerFrame === Infinity &&
        this.visibility.pendingCount === 0 &&
        visibility.members.size === this.index.size &&
        this.index.clippedAwayCount === 0,
    );
    this.changedSlotIds.clear();
    return ranges;
  }

  /**
   * Whether the visible set still has entries or exits carried to later frames
   * (`entriesPerFrame`), so the frame loop keeps drawing until it settles.
   *
   * @returns True while some are carried.
   */
  hasPendingAdmissions(): boolean {
    return this.visibility.pendingCount > 0;
  }

  /**
   * How many visible-set entries and exits the budget carried to later frames.
   *
   * @returns The count; 0 without a budget or once the set has settled.
   */
  carriedAdmissions(): number {
    return this.visibility.pendingCount;
  }

  /**
   * Reads a pass's bounded actual drawn-slot change after culling.
   *
   * @param passName - The pass.
   * @returns Its latest delta, or undefined for a safe full-range rebuild.
   */
  rangeChangeOf(passName: string): CullRangeChange | undefined {
    return this.rangeCache.changeOf(passName);
  }

  /**
   * The objects the frame draws: the indexed objects whose boxes meet the viewport padded by
   * `paddingFraction`, searched only when the padded region moved or a box entered or left it
   * (a frame may ask before `cull`, as the level-of-detail stage does, and `cull` reuses the
   * answer).
   *
   * @param viewport - The world rectangle the camera shows.
   * @returns Their ids, the same array for as long as the set is unchanged; not to be mutated.
   */
  visibleIdsFor(viewport: WorldBounds): readonly ObjectId[] {
    this.visibilityFor(viewport);
    return this.visibility.toArray();
  }

  /**
   * Returns current membership and the most recent incremental change.
   * Consumers missing a revision must reset from members; members is borrowed, not immutable.
   *
   * @param viewport - The world rectangle shown by the camera.
   * @returns A retained record until membership changes.
   */
  visibilityFor(viewport: WorldBounds): VisibilityChange {
    if (!this.query || !isQueryReusable(this.query, viewport, this.paddingFraction)) {
      this.query = padViewport(viewport, this.paddingFraction);
      this.isSearchStale = true;
    }
    const isAdmitting = this.canAdmit && this.visibility.pendingCount > 0;
    if (!this.isSearchStale && !isAdmitting && this.visibilityChange) return this.visibilityChange;
    // A second update in an installed frame (the view moved since) only carries its changes.
    const entriesPerFrame = this.canAdmit ? this.entriesPerFrame : 0;
    const budget = this.entriesPerFrame === Infinity ? undefined : { entriesPerFrame, viewport };
    const change = this.visibility.update(
      this.index,
      this.query,
      this.changedMembershipIds,
      budget,
    );
    if (this.isInstalled && budget !== undefined) this.canAdmit = false;
    this.visibilityChange = change;
    this.changedMembershipIds.clear();
    if (this.isSearchStale) {
      this.queries += 1;
      this.isSearchStale = false;
    }
    return change;
  }

  /**
   * Hooks into a frame, as `ZOrderSegments.install` does: wraps `collectChanges` so the culler
   * sees every change set the scene applies, after the scene has applied it. The wrapper keeps
   * the stage's name and runs it unchanged (it peeks at the coalesced change set and hands it
   * back, so it composes with other such wrappers). `SceneRenderer` installs its culler when it is
   * a `SpatialCuller`; a frame built by hand installs it before the first change set.
   *
   * @param frame - A frame with a `collectChanges` stage.
   * @throws {RangeError} When the frame has no `collectChanges` stage.
   */
  install(frame: Frame): void {
    this.isInstalled = true;
    frame.wrapStage('collectChanges', (stage) => ({
      name: stage.name,
      run: (context) => {
        this.canAdmit = true;
        // Take the coalesced change set, put it back for the stage to drain, then index it.
        const changes = context.changes.drain();
        if (changes) context.changes.push(changes);
        const slotRevision = context.scene.slotOwnershipRevision;
        this.isCollectingChanges = true;
        try {
          stage.run(context);
          if (changes) this.apply(changes, slotRevision === context.scene.slotOwnershipRevision);
        } finally {
          this.isCollectingChanges = false;
        }
      },
    }));
  }
}
