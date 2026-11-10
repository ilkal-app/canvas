import type { ObjectId } from '@canvas/schema';

import type { VisibilityChange } from '../spatial/spatial-visibility.js';

/** Legacy arrays or the culler's bounded change record; undefined means all visible. */
export type LodVisibilityInput = readonly ObjectId[] | VisibilityChange | undefined;

/** Owns LOD membership so later culling stages cannot mutate the evaluated visible set. */
export class LodVisibility {
  private input: LodVisibilityInput;
  private hasInitialized = false;
  private memberSet: Set<ObjectId> | undefined;
  private ids: readonly ObjectId[] | undefined;
  private source: object | undefined;
  private revision = -1;
  /** IDs to evaluate after the last update; undefined means every tracked object. */
  entered: readonly ObjectId[] | undefined;

  /**
   * Applies a consecutive delta, or resets after a skipped revision/provider change.
   *
   * @param input - The current visibility.
   * @returns Whether visibility advanced.
   */
  update(input: LodVisibilityInput): boolean {
    if (this.hasInitialized && input === this.input) return false;
    const previous = this.memberSet;
    this.hasInitialized = true;
    this.input = input;
    this.ids = undefined;
    if (input === undefined || Array.isArray(input)) {
      const ids = input as readonly ObjectId[] | undefined;
      this.source = undefined;
      this.memberSet = ids === undefined ? undefined : new Set(ids);
      this.ids = ids;
      this.entered = ids?.filter((id) => !previous?.has(id));
      return true;
    }
    const change = input as VisibilityChange;
    if (this.source === change.source && this.revision === change.revision) return false;
    const isConsecutive =
      this.source === change.source && this.revision === change.previousRevision;
    this.source = change.source;
    this.revision = change.revision;
    if (isConsecutive && this.memberSet) {
      for (const id of change.left) this.memberSet.delete(id);
      for (const id of change.entered) this.memberSet.add(id);
      this.entered = change.entered;
    } else {
      this.memberSet = new Set(change.members);
      // A missed leave/reenter can require evaluation even if the current ID was seen before.
      this.entered = [...this.memberSet];
    }
    return true;
  }

  /**
   * Materializes IDs only for legacy consumers.
   *
   * @returns The current visible IDs.
   */
  toArray(): readonly ObjectId[] | undefined {
    if (this.memberSet === undefined) return undefined;
    this.ids ??= [...this.memberSet];
    return this.ids;
  }

  /**
   * Reads membership size without materializing IDs.
   *
   * @returns The count, or undefined when every tracked object is visible.
   */
  get size(): number | undefined {
    return this.memberSet?.size;
  }

  /**
   * The visible IDs, without materializing an array.
   *
   * @returns The membership, or undefined when every tracked object is visible.
   */
  get members(): ReadonlySet<ObjectId> | undefined {
    return this.memberSet;
  }

  /**
   * Tests the independently owned membership.
   *
   * @param id - The object.
   * @returns Whether visible, including the all-visible mode.
   */
  has(id: ObjectId): boolean {
    return this.memberSet === undefined || this.memberSet.has(id);
  }
}
