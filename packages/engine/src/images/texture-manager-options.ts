import type { Camera, WorldBounds } from '../camera/camera.js';
import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { AtlasLoan } from '../memory/atlas-loan.js';
import type { DeviceMemoryBudget } from '../memory/device-budget.js';
import type { SceneObject } from '../scene/scene-pass.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import type { ImageJobRunner } from './level-loader.js';
import type { RetryTimer } from './retry-schedule.js';

/** How to build a `TextureManager`. */
export interface TextureManagerOptions {
  /** The backend textures are created on. */
  readonly backend: GpuBackend;
  /**
   * Where image descriptions and bytes come from, with the CPU copies of smallest levels; it
   * outlives the manager (a new one after a device loss reads it).
   */
  readonly catalogue: AssetCatalogue;
  /** Where `decode` jobs run (the worker pool). */
  readonly jobs: ImageJobRunner;
  /** Where texture bytes are reported (`textures`). */
  readonly ledger: MemoryLedger;
  /** The device's budget; the manager keeps under `bytesByCategory.textures`. */
  readonly budget: DeviceMemoryBudget;
  /**
   * The loan of unused texture memory to the scene text atlas, if the engine lends:
   * the manager reports what it holds and wants, and caps itself less what is borrowed.
   */
  readonly atlasLoan?: AtlasLoan;
  /** Asks for a frame: a level arrived. */
  readonly requestFrame: () => void;
  /** Loads fetching or decoding at once. Default 6. */
  readonly maxLoadsInFlight?: number;
  /** Bytes one frame uploads before the rest waits. Default 16 MiB. */
  readonly uploadBytesPerFrame?: number;
  /** Starts the waits before failed levels are retried. Default the thread's `setTimeout`. */
  readonly retryTimer?: RetryTimer;
  /**
   * Starts the wait until a playing GIF's next frame is due. Default the thread's
   * `setTimeout`; tests pass their own, as they freeze the frame clock.
   */
  readonly frameTimer?: RetryTimer;
  /**
   * Told when a `decode` job found nothing to run it (no job worker started, or all retired, and
   * no `decode` handler on this thread): the images keep their placeholder or the levels they
   * have. The image pass reports it once per engine as a fault (`ImagePassSupport`).
   *
   * @param error - The pool's error.
   */
  readonly onDecoderMissing?: (error: Error) => void;
}

/** What a frame gives the manager. */
export interface ImageFrameInput {
  /** The frame's camera. */
  readonly camera: Camera;
  /** The visible world rectangle. */
  readonly viewport: WorldBounds;
  /** The frame's sequence number. */
  readonly frameIndex: number;
  /** The frame's time, ms. */
  readonly timeMs: number;
}

/** What `TextureManager.update` did. */
export interface ImageFrameResult {
  /** Images whose binding changed: their records must be rewritten this frame. */
  readonly rebound: readonly SceneObject[];
  /**
   * Visible images of assets that were ready once (their smallest level decoded, even if its
   * CPU copy was dropped since) drawn without a texture this frame; must be 0.
   */
  readonly blankImages: number;
  /**
   * Visible images drawn from their placeholder because nothing of their asset ever loaded (not
   * described, failed, or no level decoded yet).
   */
  readonly placeholderImages: number;
  /** Visible images this frame. */
  readonly visibleImages: number;
}

/** Counters for the overlay, the benchmarks and tests. */
export interface TextureManagerStats {
  /** Levels and tiles uploaded. */
  uploads: number;
  /** Levels and tiles evicted. */
  evictions: number;
  /** Frames that drew a visible image of a ready asset without a texture. */
  blankImageFrames: number;
  /** Textures the backend refused to allocate. */
  allocationFailures: number;
  /**
   * Loads that failed because nothing could decode them: no job worker was started, or all were
   * retired, and this thread has no `decode` handler (images are never decoded on it).
   */
  decoderMissingFailures: number;
}
