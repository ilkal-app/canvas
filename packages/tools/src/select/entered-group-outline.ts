import type { ObjectId } from '@canvas/schema';

import type { OrientedBox } from './oriented-box.js';
import { SelectionFrameCache } from './selection-frame-cache.js';
import type { SelectionSource } from './selection-geometry.js';
import type { TouchedIds } from './selection-relations.js';

/**
 * The entered group's box, which the overlay outlines while a group is entered: its
 * derived box, computed once and kept until a change set touches the group, its ancestors or
 * anything under it (`SelectionFrameCache` over the one group), so a hover inside a group of
 * thousands of children costs nothing extra. Reads the document, never a drag preview. Main
 * thread.
 */
export class EnteredGroupOutline {
  private readonly cache: SelectionFrameCache;
  private groupId: ObjectId | null = null;

  /**
   * Starts with no group entered.
   *
   * @param document - The document (not the preview).
   */
  constructor(document: SelectionSource) {
    this.cache = new SelectionFrameCache(document);
  }

  /**
   * The group entered now; nothing is recomputed while it stays the same.
   *
   * @param groupId - The innermost entered group, or null.
   * @returns Whether the entered group changed.
   */
  follow(groupId: ObjectId | null): boolean {
    if (groupId === this.groupId) return false;
    this.groupId = groupId;
    this.cache.select(groupId === null ? [] : [groupId]);
    return true;
  }

  /**
   * Takes a change set: whether it may have moved or resized the entered group's box.
   *
   * @param changes - The ids the change set touched.
   * @returns True when the box may have changed; always false with no group entered.
   */
  isAffectedBy(changes: TouchedIds): boolean {
    return this.groupId !== null && this.cache.isAffectedBy(changes);
  }

  /**
   * The entered group's box.
   *
   * @returns The box, world units, or undefined with no group entered or an empty group.
   */
  box(): OrientedBox | undefined {
    return this.groupId === null ? undefined : this.cache.frame();
  }
}
