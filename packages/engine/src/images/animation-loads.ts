import type { AssetId } from '@canvas/schema';

import type { JobId } from '../workers/job-id.js';
import type { FramesJobResponse } from '../workers/job-kinds.js';

import type { AssetSource } from './asset-source.js';
import type { ImageJobRunner } from './level-loader.js';

/** The longest edge a GIF's frames are decoded at, px. */
export const MAX_ANIMATION_EDGE_PX = 512;

/** One GIF's frames being fetched and decoded. */
interface AnimationLoad {
  readonly abort: AbortController;
  jobId: JobId | undefined;
}

/** Where {@link AnimationLoads} delivers what it decoded. */
export interface AnimationLoadCallbacks {
  /**
   * A GIF's frames arrived: none when it is still.
   *
   * @param assetId - The asset.
   * @param frames - The decoded frames.
   */
  onLoaded(assetId: AssetId, frames: FramesJobResponse): void;
  /**
   * A GIF's frames could not be fetched or decoded; it keeps its still level.
   *
   * @param assetId - The asset.
   */
  onFailed(assetId: AssetId): void;
  /** A `frames` job was submitted: a pool without workers runs it when a frame drains it. */
  onQueued(): void;
}

/**
 * Fetches GIF originals and decodes their frames for playback:
 * the original through `AssetSource.fetchOriginal`, as client levels are, then a `frames` job on
 * the pool, so frames are decoded in a job worker, never on the thread that renders. A load no
 * longer wanted is cancelled: its fetch is aborted and its job cancelled. On the thread that
 * renders.
 */
export class AnimationLoads {
  private readonly loads = new Map<AssetId, AnimationLoad>();

  /**
   * Creates the loads.
   *
   * @param assets - Where originals come from.
   * @param jobs - Where `frames` jobs run.
   * @param callbacks - Where results go.
   */
  constructor(
    private readonly assets: AssetSource,
    private readonly jobs: ImageJobRunner,
    private readonly callbacks: AnimationLoadCallbacks,
  ) {}

  /**
   * Whether any GIF's frames are being fetched or decoded.
   *
   * @returns True while one is.
   */
  get isLoading(): boolean {
    return this.loads.size > 0;
  }

  /**
   * Starts fetching and decoding a GIF's frames, unless that already runs.
   *
   * @param assetId - The asset.
   * @param maxBytes - The most bytes its frames may take.
   */
  start(assetId: AssetId, maxBytes: number): void {
    if (this.loads.has(assetId)) return;
    const load: AnimationLoad = { abort: new AbortController(), jobId: undefined };
    this.loads.set(assetId, load);
    void this.run(assetId, load, maxBytes);
  }

  /**
   * Stops a GIF's load: its fetch aborted, its job cancelled, nothing delivered.
   *
   * @param assetId - The asset.
   */
  cancel(assetId: AssetId): void {
    const load = this.loads.get(assetId);
    if (load === undefined) return;
    this.loads.delete(assetId);
    load.abort.abort();
    if (load.jobId !== undefined) this.jobs.cancel(load.jobId);
  }

  /** Stops every load. */
  destroy(): void {
    for (const assetId of [...this.loads.keys()]) this.cancel(assetId);
  }

  private async run(assetId: AssetId, load: AnimationLoad, maxBytes: number): Promise<void> {
    try {
      const bytes = await this.assets.fetchOriginal(assetId, load.abort.signal);
      if (this.loads.get(assetId) !== load) return;
      const ticket = this.jobs.submit(
        'frames',
        { assetId, bytes, maxLongEdgePx: MAX_ANIMATION_EDGE_PX, maxBytes },
        { priority: 'visible', transfer: [bytes] },
      );
      load.jobId = ticket.id;
      this.callbacks.onQueued();
      const frames = await ticket.response;
      if (this.loads.get(assetId) !== load) return;
      this.loads.delete(assetId);
      this.callbacks.onLoaded(assetId, frames);
    } catch {
      if (this.loads.get(assetId) !== load) return;
      this.loads.delete(assetId);
      this.callbacks.onFailed(assetId);
    }
  }
}
