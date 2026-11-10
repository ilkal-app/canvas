import type { ObjectId } from '@canvas/schema';

import type { CullRangeChange, InstanceRange } from '../scene/scene-culler.js';
import type { Scene } from '../scene/scene.js';

import type { VisibilityChange } from './spatial-visibility.js';
import { visibleRanges } from './visible-ranges.js';
import { VisibleSlotPass } from './visible-slot-pass.js';

/** Patches partial-view slots; whole-board and missed-update resets keep the pure reference path. */
export class IncrementalVisibleRanges {
  private scene: Scene | undefined;
  /** The scene's compaction revision the ranges were built at. */
  private compaction = 0;
  private readonly passes = new Map<string, VisibleSlotPass>();
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
   * Updates ranges from membership, record ownership and LOD changes.
   *
   * @param scene - The current scene.
   * @param visibility - The current borrowed visibility record.
   * @param changed - IDs whose document records may have changed.
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
    const shouldReset =
      isSceneChanged ||
      (isVisibilityChanged && visibility.previousRevision !== this.visibilityRevision) ||
      (isHiddenChanged && lod.updateRevision !== this.lodUpdate + 1);
    if (shouldReset) this.passes.clear();
    const touched = shouldReset
      ? visibility.members
      : new Set([
          ...changed,
          ...(isVisibilityChanged ? visibility.entered : []),
          ...(isVisibilityChanged ? visibility.left : []),
        ]);
    if (isAllVisible) {
      const previous = this.output;
      // Keep an existing partial-view cache current, without constructing one for a board
      // first shown in full. Published whole-board coverage still uses the pure reference.
      if (this.passes.size > 0)
        this.patchPasses(scene, visibility.members, touched, isHiddenChanged, false);
      if (
        isSceneChanged ||
        !this.wasAllVisible ||
        isVisibilityChanged ||
        isHiddenChanged ||
        changed.size > 0
      ) {
        const rebuilt = visibleRanges(scene, [], true, this.maxGap);
        this.output = sameCoverage(previous, rebuilt) ? previous : rebuilt;
      }
    } else {
      this.patchPasses(scene, visibility.members, touched, isHiddenChanged, shouldReset);
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
    return this.wasAllVisible ? undefined : this.passes.get(name)?.latestChange;
  }

  private patchPasses(
    scene: Scene,
    members: ReadonlySet<ObjectId>,
    touched: Iterable<ObjectId>,
    isHiddenChanged: boolean,
    shouldReset: boolean,
  ): void {
    let next: Map<string, readonly InstanceRange[]> | undefined;
    for (const { name } of scene.passes) {
      let pass = this.passes.get(name);
      if (!pass) {
        pass = new VisibleSlotPass(this.maxGap);
        this.passes.set(name, pass);
      }
      const ids =
        isHiddenChanged && !shouldReset
          ? new Set([...touched, ...scene.levelOfDetail.changedIn(name)])
          : touched;
      pass.update(scene, name, members, ids);
      const ranges = pass.ranges;
      if (ranges !== this.output.get(name) && (ranges.length || this.output.has(name))) {
        next ??= new Map(this.output);
        if (ranges.length) next.set(name, ranges);
        else next.delete(name);
      }
    }
    if (next) this.output = next;
  }
}

/**
 * Preserves whole-board snapshot identity after changes that keep the same drawn coverage.
 *
 * @param previous - The previous ranges.
 * @param next - Safely rebuilt reference ranges.
 * @returns Whether the maps describe identical coverage.
 */
export function sameCoverage(
  previous: ReadonlyMap<string, readonly InstanceRange[]>,
  next: ReadonlyMap<string, readonly InstanceRange[]>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [name, ranges] of next) {
    const old = previous.get(name);
    if (old?.length !== ranges.length) return false;
    if (
      !ranges.every(
        (range, index) => range.start === old[index]?.start && range.count === old[index].count,
      )
    )
      return false;
  }
  return true;
}
