import type { AssetId, AssetStatus, ObjectId } from '@canvas/schema';

import type { PreparedImage } from './prepare-image.js';
import { QUEUED_UPLOAD, stepUpload, type UploadEvent, type UploadState } from './upload-state.js';

/** How many uploads run at once; the rest wait in order. */
export const MAX_CONCURRENT_UPLOADS = 3;

/** One upload as the shell shows it: its asset, where it stands and the objects that show it. */
export interface UploadEntry {
  /** The asset. */
  readonly assetId: AssetId;
  /** Where the upload stands. */
  readonly state: UploadState;
  /** The image objects the upload was placed as (the badge shows on each that remains). */
  readonly objectIds: readonly ObjectId[];
  /** The file's size, bytes: what its label counts to before the put reports a total. */
  readonly byteLength: number;
}

/**
 * Runs one upload, reporting its events (`runUpload`, bound to the page's client).
 *
 * @param image - The prepared image.
 * @param file - Its bytes.
 * @param onEvent - Receives what happened.
 * @param signal - Aborted when the upload is dropped (the page's images destroyed).
 * @returns Settles when it is done, has failed or was stopped.
 */
export type RunImageUpload = (
  image: PreparedImage,
  file: Blob,
  onEvent: (event: UploadEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

/** An upload being tracked. */
interface Tracked {
  readonly image: PreparedImage;
  readonly file: Blob;
  state: UploadState;
  objectIds: ObjectId[];
  /** Stops it while it runs. */
  running: AbortController | undefined;
}

/**
 * The page's image uploads: a queue of
 * at most {@link MAX_CONCURRENT_UPLOADS} running at once, one upload per asset however many
 * objects show it, each upload's state (`stepUpload`) from its own requests and then from the
 * adapter's reports of its record, a retry for a failed one, and a snapshot the shell's badges
 * render. An upload leaves the snapshot once `ready`. Page.
 */
export class ImageUploads {
  private readonly run: RunImageUpload;
  private readonly onVerified: (assetId: AssetId) => void;
  private readonly onForgotten: (assetId: AssetId) => void;
  private readonly tracked = new Map<AssetId, Tracked>();
  /** Every asset this page began uploading, kept after its upload ends. */
  private readonly added = new Set<AssetId>();
  private readonly listeners = new Set<() => void>();
  private running = 0;
  private isDestroyed = false;
  private entries: readonly UploadEntry[] = [];

  /**
   * Tracks nothing yet.
   *
   * @param run - Runs one upload.
   * @param onVerified - Told when an upload's bytes verified (the board is linked), so the
   *   engine's adapter follows its record.
   * @param onForgotten - Told when an upload is dropped, so the engine's adapter lets its bytes
   *   go.
   */
  constructor(
    run: RunImageUpload,
    onVerified: (assetId: AssetId) => void,
    onForgotten: (assetId: AssetId) => void = () => undefined,
  ) {
    this.run = run;
    this.onVerified = onVerified;
    this.onForgotten = onForgotten;
  }

  /**
   * The uploads not yet ready, in the order they were added; the same array until one changes.
   *
   * @returns The entries.
   */
  snapshot(): readonly UploadEntry[] {
    return this.entries;
  }

  /**
   * Calls `listener` after every change of {@link ImageUploads.snapshot}.
   *
   * @param listener - Called with no arguments.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Uploads an image placed as objects; an asset already being uploaded only gains the objects.
   *
   * @param image - The prepared image.
   * @param file - Its bytes.
   * @param objectIds - The objects that show it.
   */
  add(image: PreparedImage, file: Blob, objectIds: readonly ObjectId[]): void {
    this.added.add(image.assetId);
    const known = this.tracked.get(image.assetId);
    if (known !== undefined) {
      known.objectIds = [...known.objectIds, ...objectIds];
      this.changed();
      return;
    }
    this.tracked.set(image.assetId, {
      image,
      file,
      state: QUEUED_UPLOAD,
      objectIds: [...objectIds],
      running: undefined,
    });
    this.changed();
    this.pump();
  }

  /**
   * Whether this page began uploading an asset (it may have finished, failed or been removed
   * since).
   *
   * @param assetId - The asset.
   * @returns True once `add` took it.
   */
  hasAdded(assetId: AssetId): boolean {
    return this.added.has(assetId);
  }

  /**
   * Visits every upload not yet ready, with its bytes and whether they verified (`processing`:
   * the board is linked, the record is what is left to follow), so a new engine's adapter can be
   * told of them.
   *
   * @param visit - Called with each upload's image, its bytes and whether they verified.
   */
  forEachUnfinished(visit: (image: PreparedImage, file: Blob, isVerified: boolean) => void): void {
    for (const tracked of this.tracked.values()) {
      visit(tracked.image, tracked.file, tracked.state.phase === 'processing');
    }
  }

  /**
   * Tries a failed upload again.
   *
   * @param assetId - The asset.
   */
  retry(assetId: AssetId): void {
    const tracked = this.tracked.get(assetId);
    if (tracked?.state.phase !== 'failed') return;
    this.step(tracked, { type: 'retry' });
    this.pump();
  }

  /** Tries every failed upload again (the error toast's Retry). */
  retryFailed(): void {
    for (const tracked of this.tracked.values()) {
      if (tracked.state.phase === 'failed') this.step(tracked, { type: 'retry' });
    }
    this.pump();
  }

  /**
   * Cancels an upload (its placeholder's Cancel): a running one is stopped (its put
   * aborted), a queued one never starts, and it is forgotten (`forget`); the next queued upload
   * starts once the stopped one has let its slot go. The caller removes its objects.
   *
   * @param assetId - The asset.
   */
  cancel(assetId: AssetId): void {
    this.tracked.get(assetId)?.running?.abort();
    this.forget(assetId);
  }

  /**
   * Stops showing an upload (its objects were removed) and lets its bytes go: the page's here,
   * and the engine's adapter's (`onForgotten`); one still running finishes unseen.
   *
   * @param assetId - The asset.
   */
  forget(assetId: AssetId): void {
    if (!this.tracked.delete(assetId)) return;
    this.onForgotten(assetId);
    this.changed();
  }

  /** Stops every running upload and drops every upload and its bytes (the page's images end). */
  destroy(): void {
    this.isDestroyed = true;
    for (const tracked of this.tracked.values()) tracked.running?.abort();
    this.tracked.clear();
    this.changed();
    this.listeners.clear();
  }

  /**
   * Takes a report of an uploaded asset's record from the engine's adapter.
   *
   * @param assetId - The asset.
   * @param status - Its status.
   * @param progress - Its pyramid's progress.
   */
  record(assetId: AssetId, status: AssetStatus, progress: number): void {
    const tracked = this.tracked.get(assetId);
    if (tracked !== undefined) this.step(tracked, { type: 'record', status, progress });
  }

  /** Starts queued uploads while slots are free. */
  private pump(): void {
    for (const tracked of this.tracked.values()) {
      if (this.running >= MAX_CONCURRENT_UPLOADS) return;
      if (tracked.state.phase !== 'queued' || tracked.running !== undefined) continue;
      this.running += 1;
      const controller = new AbortController();
      tracked.running = controller;
      void this.run(
        tracked.image,
        tracked.file,
        (event) => {
          if (!controller.signal.aborted) this.step(tracked, event);
        },
        controller.signal,
      ).finally(() => {
        tracked.running = undefined;
        this.running -= 1;
        if (!this.isDestroyed) this.pump();
      });
    }
  }

  /**
   * Moves an upload on by one event.
   *
   * @param tracked - The upload.
   * @param event - What happened.
   */
  private step(tracked: Tracked, event: UploadEvent): void {
    const before = tracked.state;
    const after = stepUpload(before, event);
    if (after === before) return;
    tracked.state = after;
    const isVerified =
      before.phase === 'completing' && (after.phase === 'processing' || after.phase === 'ready');
    if (isVerified) this.onVerified(tracked.image.assetId);
    this.changed();
  }

  /** Rebuilds the snapshot and tells the listeners. */
  private changed(): void {
    for (const [assetId, tracked] of this.tracked) {
      if (tracked.state.phase === 'ready') this.tracked.delete(assetId);
    }
    this.entries = [...this.tracked.entries()].map(([assetId, tracked]) => ({
      assetId,
      state: tracked.state,
      objectIds: tracked.objectIds,
      byteLength: tracked.file.size,
    }));
    for (const listener of this.listeners) listener();
  }
}
