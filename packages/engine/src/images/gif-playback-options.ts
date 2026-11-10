import type { AssetId } from '@canvas/schema';

import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import type { ImageCandidate } from './image-needs.js';
import type { ImageJobRunner } from './level-loader.js';
import type { RetryTimer } from './retry-schedule.js';
import type { TextureResidency } from './texture-residency.js';

/** Bytes held back from the residency's budget for decoded frames (`LevelUploads`). */
export interface AnimationBudget {
  /**
   * Holds bytes back, evicting idle levels to make the room.
   *
   * @param bytes - The bytes.
   * @param isNeeded - Whether a resident key is needed now (never evicted).
   * @returns Whether they were held back.
   */
  reserve(bytes: number, isNeeded: (key: string) => boolean): boolean;
  /**
   * Gives held-back bytes back to the residency.
   *
   * @param bytes - The bytes.
   */
  release(bytes: number): void;
}

/** What a `GifPlayback` is built with: the texture manager's parts. */
export interface GifPlaybackOptions {
  /** The backend slot textures are written through. */
  readonly backend: GpuBackend;
  /** Where the slots live, beside the levels. */
  readonly residency: TextureResidency;
  /** The assets: which are GIFs, and where their originals come from. */
  readonly catalogue: AssetCatalogue;
  /** Where `frames` jobs run. */
  readonly jobs: ImageJobRunner;
  /** Where decoded frame bytes are reported (`textures`). */
  readonly ledger: MemoryLedger;
  /** The bytes held back from the residency for decoded frames. */
  readonly budget: AnimationBudget;
  /** The `textures` budget, bytes. */
  readonly texturesBytes: number;
  /** Whether the device is a mobile profile: at most two GIFs play at once. */
  readonly isMobile: boolean;
  /** Asks for a frame: frames arrived, or the next one is due. */
  readonly requestFrame: () => void;
  /** Starts the wait for the next frame change; the thread's `setTimeout` by default. */
  readonly timer?: RetryTimer;
  /**
   * An asset's images must be rebound this frame: it started or stopped playing.
   *
   * @param assetId - The asset.
   */
  readonly onChanged: (assetId: AssetId) => void;
}

/** What a frame gives the playback. */
export interface PlaybackFrame {
  /** The frame's image candidates; the visible ones may play. */
  readonly candidates: readonly ImageCandidate[];
  /**
   * Changes whenever the candidates may be other images (`CandidateFinder.candidateRevision`);
   * between changes only their priorities change, in place.
   */
  readonly candidateRevision: number;
  /** The camera zoom, CSS px per world unit. */
  readonly zoom: number;
  /** The frame's time, ms: the clock playback is timed by. */
  readonly timeMs: number;
  /** The frame's sequence number, as the slots' last use. */
  readonly frameIndex: number;
  /** Whether a resident key is needed now (never evicted by a frame's upload). */
  readonly isNeeded: (key: string) => boolean;
}
