import type { AtlasLoan } from '../memory/atlas-loan.js';
import type { DecodedLevel } from '../workers/job-kinds.js';
import type { JobPriority } from '../workers/job-priority.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import { parseLevelKey, type Want } from './image-needs.js';
import type { TextureResidency } from './texture-residency.js';
import { UploadQueue, type UploadOutcome } from './upload-queue.js';

/** Bytes a frame uploads before later levels wait for the next frame (the first always goes). */
export const DEFAULT_UPLOAD_BYTES_PER_FRAME = 16 * 1024 * 1024;

/** The priorities of the levels an image needs now, most urgent first. */
const NEEDED_PRIORITIES: readonly JobPriority[] = ['visible', 'near'];

/** How far the budget drops after an allocation failure, and its floor. */
const ALLOCATION_FAILURE_SCALE = 0.75;
const MIN_BUDGET_SCALE = 0.25;

/** What {@link LevelUploads} tells the texture manager. */
export interface LevelUploadEvents {
  /**
   * A level or tile is resident now.
   *
   * @param key - Its key.
   */
  onUploaded(key: string): void;
  /** The backend refused a texture: the budget was lowered and idle levels evicted. */
  onAllocationFailed(): void;
  /**
   * A needed level did not fit the budget while bytes were held back for animation frames
   * (`reserve`): the owner gives some back.
   */
  onPressure?(): void;
}

/**
 * The texture manager's uploads: each
 * frame, under one byte cap, first the needed smallest levels from their CPU copies (never blank;
 * after a device loss all of them, images on screen first, spread over as many frames as the cap
 * needs, the first of a frame always going), then the decoded levels waiting in the
 * `UploadQueue`. An allocation failure lowers the residency's budget by a quarter (down to a
 * quarter of the cap) and evicts every idle level, so images drop to lower levels. On the thread
 * that renders.
 */
export class LevelUploads {
  private readonly queue: UploadQueue;
  private budgetScale = 1;
  /** Bytes held back from the residency's budget for decoded animation frames. */
  private reserved = 0;

  /**
   * Creates the uploads of one texture manager.
   *
   * @param residency - Where levels go.
   * @param catalogue - The CPU copies of the smallest levels.
   * @param texturesBytes - The device's `textures` budget, bytes.
   * @param bytesPerFrame - Bytes one frame uploads before the rest waits.
   * @param events - Where uploads and allocation failures are told.
   * @param loan - The loan of unused texture memory to the scene text atlas, if any.
   */
  constructor(
    private readonly residency: TextureResidency,
    private readonly catalogue: AssetCatalogue,
    private readonly texturesBytes: number,
    private readonly bytesPerFrame: number,
    private readonly events: LevelUploadEvents,
    private readonly loan?: AtlasLoan,
  ) {
    this.queue = new UploadQueue(bytesPerFrame);
  }

  /**
   * How many decoded levels wait.
   *
   * @returns The count.
   */
  get size(): number {
    return this.queue.size;
  }

  /**
   * Whether a decoded level waits.
   *
   * @param key - Its key.
   * @returns True when queued.
   */
  has(key: string): boolean {
    return this.queue.has(key);
  }

  /**
   * Holds bytes back from the residency's budget for decoded animation frames: the
   * budget the levels live under drops by them, evicting idle levels (larger and older first)
   * to make the room, so levels and frames together stay under the `textures` budget. When the
   * needed levels leave no room, nothing is held back or evicted.
   *
   * @param bytes - The bytes.
   * @param isNeeded - Whether a resident key is needed now (never evicted).
   * @returns Whether they were held back.
   */
  reserve(bytes: number, isNeeded: (key: string) => boolean): boolean {
    // The scene text atlas gives back what it borrows first: images keep priority.
    this.loan?.reclaim(bytes);
    this.reserved += bytes;
    this.applyBudget();
    if (this.residency.fitBudget(isNeeded)) return true;
    this.release(bytes);
    return false;
  }

  /**
   * Gives bytes held back by `reserve` back to the levels.
   *
   * @param bytes - The bytes.
   */
  release(bytes: number): void {
    this.reserved = Math.max(0, this.reserved - bytes);
    this.applyBudget();
  }

  /**
   * Queues a decoded level for the next frames.
   *
   * @param key - Its key.
   * @param level - Its pixels.
   */
  add(key: string, level: DecodedLevel): void {
    this.queue.add(key, level);
  }

  /**
   * Uploads what this frame can.
   *
   * @param wants - The frame's wants: priorities, and what is needed.
   * @param frameIndex - The frame, as the uploads' last use.
   * @param isNeeded - Whether a resident key is needed now (never evicted).
   * @returns Whether levels were left for the next frame by the byte cap.
   */
  upload(
    wants: ReadonlyMap<string, Want>,
    frameIndex: number,
    isNeeded: (key: string) => boolean,
  ): boolean {
    let spent = 0;
    let isDeferred = false;
    for (const priority of NEEDED_PRIORITIES) {
      for (const [key, want] of wants) {
        if (want.priority !== priority || !want.isNeeded) continue;
        if (this.residency.get(key) !== undefined || this.queue.has(key)) continue;
        const copy = this.catalogue.smallestOf(want.source);
        if (copy === undefined) continue;
        if (spent > 0 && spent + copy.rgba.byteLength > this.bytesPerFrame) {
          isDeferred = true;
          continue;
        }
        const outcome = this.uploadOne(key, copy, frameIndex, isNeeded);
        if (outcome === 'uploaded') spent += copy.rgba.byteLength;
      }
    }
    // A queued level already resident is a newer version (the server's in place of the
    // client's): the residency replaces it.
    const isQueueDeferred = this.queue.flush(
      wants,
      (key, level) => this.uploadQueued(key, level, frameIndex, isNeeded),
      spent,
    );
    return isDeferred || isQueueDeferred;
  }

  /**
   * What an upload may not evict: what is needed now, except the levels of its own asset below
   * it, other than the smallest. Those are kept needed only to be shown until it is resident
   * (`ImagePlanner`), and the upload replaces them in the same step (a level upgrade under
   * budget pressure evicts the level it replaces, and the image is never blank). Another asset's
   * upload may still not evict them.
   *
   * @param key - The key being uploaded.
   * @param isNeeded - Whether a resident key is needed now.
   * @returns The predicate for this upload.
   */
  private replacing(key: string, isNeeded: (key: string) => boolean): (key: string) => boolean {
    const upload = parseLevelKey(key);
    if (upload === undefined) return isNeeded;
    const smallest = this.catalogue.peek(upload.assetId)?.levels[0];
    return (other) => {
      if (!isNeeded(other)) return false;
      const resident = parseLevelKey(other);
      return (
        resident?.assetId !== upload.assetId ||
        resident.longEdgePx >= upload.longEdgePx ||
        resident.longEdgePx === smallest
      );
    };
  }

  /**
   * Uploads a queued level. A newer version of a resident level that the budget refuses is
   * dropped, not retried each frame: the resident version keeps serving.
   *
   * @param key - The key.
   * @param level - Its pixels.
   * @param frameIndex - The frame, as its last use.
   * @param isNeeded - Whether a resident key is needed now.
   * @returns What happened.
   */
  private uploadQueued(
    key: string,
    level: DecodedLevel,
    frameIndex: number,
    isNeeded: (key: string) => boolean,
  ): UploadOutcome {
    const isReplacement = this.residency.get(key) !== undefined;
    const outcome = this.uploadOne(key, level, frameIndex, isNeeded);
    return isReplacement && outcome === 'over-budget' ? 'kept' : outcome;
  }

  private uploadOne(
    key: string,
    level: DecodedLevel,
    frameIndex: number,
    isNeeded: (key: string) => boolean,
  ): UploadOutcome {
    const result = this.residency.upload(key, level, frameIndex, this.replacing(key, isNeeded));
    if (result === 'allocation-failed') {
      // On an allocation failure drop to lower levels everywhere and rebuild. The scene text
      // atlas gives back all it borrows first, so the lower cap is the images' alone.
      this.loan?.reclaim(Number.POSITIVE_INFINITY);
      this.budgetScale = Math.max(MIN_BUDGET_SCALE, this.budgetScale * ALLOCATION_FAILURE_SCALE);
      this.applyBudget();
      this.residency.evictIdle(isNeeded);
      this.events.onAllocationFailed();
      return result;
    }
    if (result === 'over-budget' && this.reserved > 0 && isNeeded(key)) this.events.onPressure?.();
    if (typeof result === 'string') return result;
    this.events.onUploaded(key);
    return 'uploaded';
  }

  /**
   * Caps the residency again, at what the scene text atlas has borrowed now: called at
   * the start of every update, since the atlas's borrowing moves between frames.
   *
   * @returns Whether the cap rose: levels held back may fit now.
   */
  refreshBudget(): boolean {
    const before = this.residency.budgetBytes;
    this.applyBudget();
    return this.residency.budgetBytes > before;
  }

  /**
   * After a plan: tells the loan what the textures hold, want and may hold, and takes back from
   * the scene text atlas what the plan wanted past the cap.
   *
   * @param wantedBytes - The plan's ideal picks' bytes, at the full budget's scale.
   * @returns Whether the cap rose, so the plan should run again.
   */
  settleDemand(wantedBytes: number): boolean {
    this.reportDemand(wantedBytes);
    return this.reclaimFor(this.residency.residentBytes + wantedBytes);
  }

  /**
   * Tells the loan what the textures hold and what their ideal levels want, if there is a loan.
   *
   * @param wantedBytes - The ideal picks' bytes, at the full budget's scale.
   */
  reportDemand(wantedBytes: number): void {
    // Need counted high: what is resident (atlas pages of small levels included) plus what the
    // plan wants, so the loan errs towards the images.
    const neededBytes = this.residency.residentBytes + wantedBytes;
    this.loan?.reportTextures(this.residency.residentBytes, neededBytes, this.capacityBytes());
  }

  /**
   * Whether the scene text atlas borrows texture memory now.
   *
   * @returns Whether it does.
   */
  isLending(): boolean {
    return (this.loan?.borrowedBytes ?? 0) > 0;
  }

  /**
   * Takes memory back from the scene text atlas when the levels want more than the cap allows
   * while it borrows, so images are planned against their whole share.
   *
   * @param wantedBytes - The ideal picks' bytes, at the full budget's scale.
   * @returns Whether the cap rose.
   */
  private reclaimFor(wantedBytes: number): boolean {
    const before = this.residency.budgetBytes;
    if (this.loan === undefined || wantedBytes <= before) return false;
    this.loan.reclaim(wantedBytes - before);
    this.applyBudget();
    return this.residency.budgetBytes > before;
  }

  /**
   * What the levels may hold without a loan: the share scaled after allocation failures, less
   * GIF reservations.
   *
   * @returns Bytes.
   */
  private capacityBytes(): number {
    return Math.max(0, this.texturesBytes * this.budgetScale - this.reserved);
  }

  private applyBudget(): void {
    const borrowed = this.loan?.borrowedBytes ?? 0;
    this.residency.budgetBytes = Math.max(0, this.capacityBytes() - borrowed);
  }
}
