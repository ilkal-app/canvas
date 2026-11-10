import type { DecodedLevel } from '../workers/job-kinds.js';
import { priorityRank } from '../workers/job-priority.js';

import type { Want } from './image-needs.js';
import type { UploadRefusal } from './texture-residency.js';

/**
 * What happened to one upload: it went up, it was refused, or (`kept`) a newer version of a
 * resident level was refused and the resident one stays.
 */
export type UploadOutcome = 'uploaded' | UploadRefusal | 'kept';

/**
 * Decoded levels waiting for the GPU: each
 * frame uploads the most urgent first, smaller before larger at equal urgency, until
 * `bytesPerFrame` is spent (the first always goes, however large); the rest waits for the next
 * frame. A level the frame no longer wants is dropped. On the thread that renders.
 */
export class UploadQueue {
  private readonly pending = new Map<string, DecodedLevel>();

  /**
   * Creates an empty queue.
   *
   * @param bytesPerFrame - Bytes one frame uploads before the rest waits.
   */
  constructor(private readonly bytesPerFrame: number) {}

  /**
   * How many levels wait.
   *
   * @returns The count.
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Whether a level waits.
   *
   * @param key - Its key.
   * @returns True when queued.
   */
  has(key: string): boolean {
    return this.pending.has(key);
  }

  /**
   * Queues a decoded level, replacing an earlier one of the same key.
   *
   * @param key - Its key.
   * @param level - Its pixels.
   */
  add(key: string, level: DecodedLevel): void {
    this.pending.set(key, level);
  }

  /**
   * Uploads what this frame can.
   *
   * @param wants - The frame's wants: priorities, and what is not wanted any more.
   * @param upload - Uploads one level and says how it went.
   * @param spentBytes - Bytes the frame already uploaded (smallest levels from their CPU
   *   copies): the cap counts them, and when they are above 0 the first level no longer always goes.
   * @returns Whether levels were left for the next frame by the byte cap (not by the budget).
   */
  flush(
    wants: ReadonlyMap<string, Want>,
    upload: (key: string, level: DecodedLevel) => UploadOutcome,
    spentBytes = 0,
  ): boolean {
    for (const key of this.pending.keys()) {
      if (!wants.has(key)) this.pending.delete(key);
    }
    const rank = (key: string): number => priorityRank(wants.get(key)?.priority ?? 'prefetch');
    const queue = [...this.pending].sort(
      ([a, first], [b, second]) =>
        rank(a) - rank(b) || first.rgba.byteLength - second.rgba.byteLength,
    );
    let uploaded = spentBytes;
    for (const [key, level] of queue) {
      if (uploaded > 0 && uploaded + level.rgba.byteLength > this.bytesPerFrame) return true;
      const outcome = upload(key, level);
      if (outcome === 'uploaded') uploaded += level.rgba.byteLength;
      // A level that failed to allocate is dropped: the manager falls back to lower levels.
      if (outcome !== 'over-budget') {
        this.pending.delete(key);
      }
    }
    return false;
  }
}
