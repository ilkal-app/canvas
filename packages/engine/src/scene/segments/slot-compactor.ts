// Slot order for z-ordered drawing: draws stay bounded by segments × passes × pages
// only while each pass's records sit in consecutive slots in paint order (`planSegmentDraws`).
// Boards arrive in chunked change sets and in document order, so this sorts each large load by
// paint rank before the scene allocates its slots, and, on still frames, re-slots fragmented
// passes in paint order a chunk at a time (`Scene.compactSlots`).
import type { ObjectId } from '@canvas/schema';

import { isSameCamera, type Camera } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';
import type { SceneChangeSet } from '../scene-source.js';
import type { Scene } from '../scene.js';

import type { SlotOwnerTable } from './slot-owner-table.js';

/** The fewest created objects a change set sorts by paint rank before the scene applies it. */
export const PAINT_ORDER_BATCH = 64;

/** Each object's paint rank, and each closing rank. */
export interface CompactionRanks {
  /** Each object's own paint rank. */
  readonly rankById: ReadonlyMap<ObjectId, number>;
  /** Each closing rank. */
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
}

/** When and how much the z-order segments re-slot (`ZOrderSegmentsOptions.compaction`). */
export interface SlotCompactionOptions {
  /**
   * A pass is re-slotted once its last plan drew more than this many ranges per draw-list entry
   * (an entry is one segment's, or one page's, records of the pass). Default 4.
   */
  readonly ratio?: number;
  /**
   * The most records one frame re-slots, so a large board is spread over frames. Default 4,096:
   * on the 50k board a step of 16,384 path records, with what follows the moved records (the
   * culler's ranges, the path meshes), took about 36 ms of a frame; 4,096 about 27.
   */
  readonly recordsPerFrame?: number;
  /**
   * A pass is re-slotted only once it drew at least one extra range (past one per entry) for
   * every this many of its records. A re-slot moves every record of the pass over
   * several frames, so a few objects inserted in the middle of the paint order (strokes drawn
   * into sections, each a range apart from its neighbours' slots) are cheaper drawn as a few more
   * ranges than moved with the whole pass after each one. Default 64.
   */
  readonly recordsPerExtraRange?: number;
}

/** The defaults of {@link SlotCompactionOptions}. */
export const DEFAULT_SLOT_COMPACTION: Required<SlotCompactionOptions> = {
  ratio: 4,
  recordsPerFrame: 4_096,
  recordsPerExtraRange: 64,
};

/**
 * A change set whose `created` follows paint rank, for a load of at least
 * {@link PAINT_ORDER_BATCH} objects not already in that order; else the same change set.
 *
 * @param changes - The coalesced change set, as the mirror has just observed it.
 * @param rankOf - Each object's paint rank, built from the mirror.
 * @returns The change set the scene should apply.
 */
export function inPaintOrder(
  changes: SceneChangeSet,
  rankOf: () => ReadonlyMap<ObjectId, number>,
): SceneChangeSet {
  const { created } = changes;
  if (created.length < PAINT_ORDER_BATCH) return changes;
  const ranks = rankOf();
  const rank = (id: ObjectId): number => ranks.get(id) ?? Number.MAX_SAFE_INTEGER;
  if (created.every((id, index) => index === 0 || rank(created[index - 1] ?? id) <= rank(id))) {
    return changes;
  }
  const sorted = [...created].sort((left, right) => rank(left) - rank(right));
  return {
    created: sorted,
    updated: changes.updated,
    deleted: changes.deleted,
    get: (id) => changes.get(id),
  };
}

interface CompactionJob {
  readonly passName: string;
  /** The pass's objects in paint order. */
  readonly order: readonly ObjectId[];
  /** The next object of `order` to place. */
  next: number;
  /** Whether the job appends past every slot handed out, its low slots being taken. */
  readonly isFresh: boolean;
}

/**
 * Re-slots fragmented passes in paint order on still frames (no change set, the same camera as
 * the frame before, no retained move). Each frame places the next objects of a pass's paint
 * order, at most `recordsPerFrame` records (or one object, when it alone is more), after those
 * already placed (`Scene.compactSlots`): into the lowest slots when every record of the pass lies
 * above as many slots as it has records, else appended past every slot handed out, so each record
 * moves once and none makes way for another. Appending leaves the low slots free for the next
 * job, and a job that fills them trims the buffer's top (`InstanceBuffer.trimHighWater`), so
 * jobs alternate between the two regions and a pass's buffer stays within about twice its records. A change set cancels the job; the
 * pass is found fragmented again after the next plan.
 */
export class SlotCompactor {
  private readonly options: Required<SlotCompactionOptions> | undefined;
  /** Fragmented passes, by ranges per entry. */
  private readonly pending = new Map<string, number>();
  /** Passes re-slotted since the last change set: not re-slotted again until one arrives. */
  private readonly settled = new Set<string>();
  private job: CompactionJob | undefined;
  private lastCamera: Camera | undefined;
  private records = 0;
  private compactionRevision = 0;
  /** The passes this compactor re-slotted since the last refresh, and how many times. */
  private readonly compacted = new Set<string>();
  private compactedCount = 0;

  /**
   * Creates the compactor.
   *
   * @param options - Its options, or `false` to never re-slot.
   * @param slots - The z-order segments' slot-owner table, rebuilt after a re-slot.
   * @param ranks - Each object's paint rank and each closing rank, built when needed.
   */
  constructor(
    options: SlotCompactionOptions | false | undefined,
    private readonly slots: SlotOwnerTable,
    private readonly ranks: () => CompactionRanks,
  ) {
    this.options = options === false ? undefined : { ...DEFAULT_SLOT_COMPACTION, ...options };
  }

  /**
   * Records re-slotted so far.
   *
   * @returns The count.
   */
  get recordCount(): number {
    return this.records;
  }

  /**
   * Rebuilds a slot-owner table after a new paint order or re-slotted records
   * (`Scene.compactionRevision`), or patches it when only record counts changed.
   *
   * @param scene - The scene.
   * @param isOrderDirty - Whether the paint order changed.
   * @param isSlotsDirty - Whether record counts changed.
   * @returns Whether records were re-slotted since the last call.
   */
  refresh(scene: Scene, isOrderDirty: boolean, isSlotsDirty: boolean): boolean {
    const isCompacted = scene.compactionRevision !== this.compactionRevision;
    // Only this compactor's re-slots since the last refresh: their passes alone moved.
    const isOwnOnly = scene.compactionRevision === this.compactionRevision + this.compactedCount;
    const passNames = new Set(this.compacted);
    this.compactionRevision = scene.compactionRevision;
    this.compacted.clear();
    this.compactedCount = 0;
    if (!isOrderDirty && !isCompacted && !isSlotsDirty) return false;
    const { rankById, closingRankById } = this.ranks();
    if (isCompacted && isOwnOnly && !isOrderDirty && !isSlotsDirty)
      this.slots.rebuildPasses(scene, passNames, rankById, closingRankById);
    else if (isOrderDirty || isCompacted) this.slots.rebuild(scene, rankById, closingRankById);
    else this.slots.patch(scene, rankById, closingRankById);
    return isCompacted;
  }

  /**
   * Whether a fragmented pass is still waiting to be re-slotted.
   *
   * @returns True while one is.
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Runs at the start of a frame, before the scene applies its change set: re-slots one chunk
   * when the frame is still, else notes what makes it not.
   *
   * @param scene - The scene.
   * @param camera - This frame's camera.
   * @param hasChanges - Whether the frame brought a change set.
   */
  beforeFrame(scene: Scene, camera: Camera, hasChanges: boolean): void {
    const isStill = this.lastCamera !== undefined && isSameCamera(this.lastCamera, camera);
    this.lastCamera = camera;
    if (hasChanges) {
      this.job = undefined;
      this.settled.clear();
      return;
    }
    if (this.options === undefined || !isStill || this.pending.size === 0) return;
    this.job ??= this.start(scene);
    if (this.job) this.step(scene, this.job, this.options.recordsPerFrame);
  }

  /**
   * Notes the passes a plan drew fragmented: more ranges per entry than `ratio`, and at least
   * one extra range for every `recordsPerExtraRange` records of the pass.
   *
   * @param entries - The plan's draw list.
   * @param recordCountOf - A pass's record count.
   */
  notePlan(entries: readonly DrawListEntry[], recordCountOf: (passName: string) => number): void {
    if (this.options === undefined) return;
    const counts = new Map<string, { entries: number; ranges: number }>();
    for (const { passName, ranges } of entries) {
      const count = counts.get(passName) ?? { entries: 0, ranges: 0 };
      count.entries += 1;
      count.ranges += ranges.length;
      counts.set(passName, count);
    }
    this.pending.clear();
    const { ratio, recordsPerExtraRange } = this.options;
    for (const [passName, count] of counts) {
      const perEntry = count.ranges / count.entries;
      const isRunning = this.job?.passName === passName;
      const isWorthMoving =
        (count.ranges - count.entries) * recordsPerExtraRange >= recordCountOf(passName);
      if (isRunning || (perEntry > ratio && isWorthMoving && !this.settled.has(passName)))
        this.pending.set(passName, perEntry);
    }
  }

  private start(scene: Scene): CompactionJob | undefined {
    const [passName] = [...this.pending].sort((left, right) => right[1] - left[1])[0] ?? [];
    if (passName === undefined) return undefined;
    const holds = scene.slotEntriesOf(passName);
    // The pass's own objects by paint rank (sorting what the pass draws costs what it
    // draws, where filtering the whole paint order cost the board on every job's first frame).
    const { rankById } = this.ranks();
    const ranked: (readonly [ObjectId, number])[] = [];
    for (const [id, slots] of holds) {
      const rank = rankById.get(id);
      if (slots.length > 0 && rank !== undefined) ranked.push([id, rank]);
    }
    const order = ranked.sort((left, right) => left[1] - right[1]).map(([id]) => id);
    // Fill the lowest slots when they are free (as after an appending job), else append: either
    // way no record has to make way for another, so each moves once.
    let records = 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (const slots of holds.values()) {
      records += slots.length;
      for (const slot of slots) lowest = Math.min(lowest, slot);
    }
    return { passName, order, next: 0, isFresh: lowest < records };
  }

  private step(scene: Scene, job: CompactionJob, recordsPerFrame: number): void {
    const holds = scene.slotEntriesOf(job.passName);
    const chunk: ObjectId[] = [];
    let records = 0;
    for (let index = job.next; index < job.order.length; index += 1) {
      const id = job.order[index];
      if (id === undefined) break;
      const count = holds.get(id)?.length ?? 0;
      if (chunk.length > 0 && records + count > recordsPerFrame) break;
      chunk.push(id);
      records += count;
    }
    const moved = scene.compactSlots(job.passName, chunk, job.isFresh);
    if (moved === 0) return;
    this.compacted.add(job.passName);
    this.compactedCount += 1;
    this.records += moved;
    job.next += chunk.length;
    if (job.next < job.order.length) return;
    // The records moved up leave free slots at the top: the next job appends right after them.
    scene.instanceBufferOf(job.passName).trimHighWater();
    this.settled.add(job.passName);
    this.pending.delete(job.passName);
    this.job = undefined;
  }
}
