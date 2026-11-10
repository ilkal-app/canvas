// The culler's visible ranges kept in typed tables by dense object handle: the default
// `rangeCache`, beside `IncrementalVisibleRanges` (`'reference'`). Partial views are patched per
// pass by `VisibleSlotTable`. On entering a whole-board view the partial-view passes are dropped,
// not patched (the zoom-out to every object visible used to patch thousands of entering objects
// only to publish the reference ranges anyway), and the published ranges are the reference
// `visibleRanges`; leaving it rebuilds the passes from the current membership, linear and
// allocation-light through the tables. `changeOf` keeps its contract: undefined while the whole
// board is shown, and a full change after a rebuild.
import type { ObjectId } from '@canvas/schema';

import type { CullRangeChange, InstanceRange } from '../scene/scene-culler.js';
import type { Scene } from '../scene/scene.js';

import { sameCoverage } from './incremental-visible-ranges.js';
import type { VisibilityChange } from './spatial-visibility.js';
import { visibleRanges } from './visible-ranges.js';
import { VisibleSlotTable, type ResolvedTouched } from './visible-slot-table.js';

/** Patches partial-view slots by handle; whole-board views publish the pure reference. */
export class VisibleRangeTables {
  private scene: Scene | undefined;
  /** The scene's compaction revision the ranges were built at. */
  private compaction = 0;
  private passes: (VisibleSlotTable | undefined)[] = [];
  private output: ReadonlyMap<string, readonly InstanceRange[]> = new Map();
  private visibilityRevision = -1;
  private hiddenRevision = -1;
  private lodUpdate = -1;
  private wasAllVisible = false;

  /**
   * Creates an empty range cache.
   *
   * @param maxGap - The greatest unmarked gap drawn through.
   */
  constructor(private readonly maxGap: number) {}

  /**
   * Updates ranges from membership, record ownership and level-of-detail changes.
   *
   * @param scene - The current scene.
   * @param visibility - The current borrowed visibility record.
   * @param changed - Ids whose document records may have changed.
   * @param isAllVisible - Whether every indexed object is visible.
   * @returns The retained map when drawn coverage is unchanged.
   */
  update(
    scene: Scene,
    visibility: VisibilityChange,
    changed: ReadonlySet<ObjectId>,
    isAllVisible: boolean,
  ): ReadonlyMap<string, readonly InstanceRange[]> {
    const lod = scene.levelOfDetail;
    // Re-slotted records (`Scene.compactSlots`) invalidate every cached slot.
    const isSceneChanged = this.scene !== scene || scene.compactionRevision !== this.compaction;
    if (isSceneChanged) this.output = new Map();
    const isVisibilityChanged = visibility.revision !== this.visibilityRevision;
    const isHiddenChanged = lod.hiddenRevision !== this.hiddenRevision;
    if (!isSceneChanged && !isVisibilityChanged && !isHiddenChanged && changed.size === 0) {
      this.lodUpdate = lod.updateRevision;
      return this.output;
    }
    if (isAllVisible) {
      // The partial-view passes are rebuilt when the view next narrows.
      this.passes = [];
      const previous = this.output;
      const rebuilt = visibleRanges(scene, [], true, this.maxGap);
      this.output = sameCoverage(previous, rebuilt) ? previous : rebuilt;
    } else {
      const shouldReset =
        isSceneChanged ||
        this.wasAllVisible ||
        (isVisibilityChanged && visibility.previousRevision !== this.visibilityRevision) ||
        (isHiddenChanged && lod.updateRevision !== this.lodUpdate + 1);
      if (shouldReset) this.passes = [];
      const touched: Iterable<ObjectId>[] = [changed];
      if (isVisibilityChanged) touched.push(visibility.entered, visibility.left);
      this.patchPasses(scene, visibility.members, touched, isHiddenChanged && !shouldReset);
    }
    this.scene = scene;
    this.compaction = scene.compactionRevision;
    this.visibilityRevision = visibility.revision;
    this.hiddenRevision = lod.hiddenRevision;
    this.lodUpdate = lod.updateRevision;
    this.wasAllVisible = isAllVisible;
    return this.output;
  }

  /**
   * Reads a pass's latest precise drawn-slot delta.
   *
   * @param name - The pass.
   * @returns The bounded delta, or undefined for a whole-board reference rebuild.
   */
  changeOf(name: string): CullRangeChange | undefined {
    if (this.wasAllVisible || this.scene === undefined) return undefined;
    return this.passes[this.scene.handles.passIndexOf(name)]?.latestChange;
  }

  private patchPasses(
    scene: Scene,
    members: ReadonlySet<ObjectId>,
    touched: Iterable<ObjectId>[],
    isHiddenChanged: boolean,
  ): void {
    let next: Map<string, readonly InstanceRange[]> | undefined;
    // Each touched id resolved once for every pass: its handle and membership.
    const resolved = resolveTouched(scene, members, touched);
    scene.passes.forEach(({ name }, passIndex) => {
      let pass = this.passes[passIndex];
      if (!pass) {
        pass = new VisibleSlotTable(this.maxGap);
        this.passes[passIndex] = pass;
      }
      const extra = isHiddenChanged ? [scene.levelOfDetail.changedIn(name)] : [];
      pass.updateResolved(
        scene,
        passIndex,
        name,
        resolved,
        scene.levelOfDetail.hiddenIn(name),
        extra,
      );
      const ranges = pass.ranges;
      if (ranges !== this.output.get(name) && (ranges.length || this.output.has(name))) {
        next ??= new Map(this.output);
        if (ranges.length) next.set(name, ranges);
        else next.delete(name);
      }
    });
    if (next) this.output = next;
  }
}

/**
 * Resolves touched ids once for every pass: each id with a handle, and whether it is visible.
 *
 * @param scene - The scene, for the handles.
 * @param members - The visible membership.
 * @param touched - Groups of ids; an id may appear more than once.
 * @returns The resolved ids.
 */
function resolveTouched(
  scene: Scene,
  members: ReadonlySet<ObjectId>,
  touched: readonly Iterable<ObjectId>[],
): ResolvedTouched {
  const ids: ObjectId[] = [];
  const handles: number[] = [];
  const memberFlags: number[] = [];
  for (const group of touched) {
    for (const id of group) {
      const handle = scene.handles.handleOf(id);
      if (handle === undefined) continue;
      ids.push(id);
      handles.push(handle);
      memberFlags.push(members.has(id) ? 1 : 0);
    }
  }
  return { ids, handles, isMember: Uint8Array.from(memberFlags), members };
}
