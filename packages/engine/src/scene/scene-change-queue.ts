import type { ObjectId } from '@canvas/schema';

import { isRootMoveChanges, markRootMoveChanges } from './root-move-changes.js';
import type { SceneChangeSet } from './scene-source.js';

/**
 * Holds the document change sets that arrive between frames so the frame applies them once
 * (remote updates are coalesced and applied once per frame, not once per message). Push from the
 * document subscription; the `collectChanges` stage drains it.
 */
export class SceneChangeQueue {
  private readonly pending: SceneChangeSet[] = [];

  /**
   * The number of change sets waiting.
   *
   * @returns The count.
   */
  get size(): number {
    return this.pending.length;
  }

  /**
   * Queues a change set. Change sets must be pushed in the order the document produced them.
   *
   * @param changes - The change set.
   */
  push(changes: SceneChangeSet): void {
    this.pending.push(changes);
  }

  /**
   * Takes every queued change set as one: the ids of each list merged without duplicates, read
   * through the latest change set's `get`, which sees the document after all of them.
   *
   * @returns The coalesced change set, or `undefined` when none was queued.
   */
  drain(): SceneChangeSet | undefined {
    const pending = this.pending.splice(0);
    const latest = pending.at(-1);
    if (!latest || pending.length === 1) return latest;
    const merge = (pick: (changes: SceneChangeSet) => readonly ObjectId[]): ObjectId[] => [
      ...new Set(pending.flatMap(pick)),
    ];
    const combined = {
      created: merge((changes) => changes.created),
      updated: merge((changes) => changes.updated),
      deleted: merge((changes) => changes.deleted),
      get: (id: ObjectId) => latest.get(id),
    };
    return pending.every(isRootMoveChanges) ? markRootMoveChanges(combined) : combined;
  }
}
