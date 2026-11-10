import type { AssetId } from '@canvas/schema';

import type { DecodedLevel } from '../workers/job-kinds.js';

import { BindingTable } from './binding-table.js';
import { GifPlayback } from './gif-playback.js';
import { LevelLoader, type LevelSource } from './level-loader.js';
import { DEFAULT_UPLOAD_BYTES_PER_FRAME, LevelUploads } from './level-uploads.js';
import { RetrySchedule } from './retry-schedule.js';
import type { TextureManagerOptions } from './texture-manager-options.js';
import { TextureResidency } from './texture-residency.js';

/** What the parts of a texture manager tell it. */
export interface TextureManagerHooks {
  /**
   * A level's pixels arrived.
   *
   * @param key - Its key.
   * @param level - Its pixels.
   * @param source - Where they came from.
   */
  readonly onLoaded: (key: string, level: DecodedLevel, source: LevelSource) => void;
  /**
   * A `decode` job found nothing to run it.
   *
   * @param error - The pool's error.
   */
  readonly onDecoderMissing: (error: Error) => void;
  /**
   * A level, tile or playback slot was evicted.
   *
   * @param key - Its key.
   */
  readonly onEvicted: (key: string) => void;
  /**
   * A level or tile is resident now.
   *
   * @param key - Its key.
   */
  readonly onUploaded: (key: string) => void;
  /** The backend refused a texture. */
  readonly onAllocationFailed: () => void;
  /**
   * A GIF started or stopped playing: its images are rebound this frame.
   *
   * @param assetId - The asset.
   */
  readonly onPlaybackChanged: (assetId: AssetId) => void;
  /** Something changed that the next update must plan for: ask for a frame. */
  readonly markStale: () => void;
}

/** The parts a texture manager is made of. */
export interface TextureManagerParts {
  /** Fetches and decodes levels by priority. */
  readonly loader: LevelLoader;
  /** The levels on the GPU and their budget. */
  readonly residency: TextureResidency;
  /** What each image draws. */
  readonly table: BindingTable;
  /** Each frame's uploads, and the bytes held back for animation frames. */
  readonly uploads: LevelUploads;
  /** Animated GIF playback. */
  readonly playback: GifPlayback;
}

/**
 * Builds a texture manager's parts and wires them to each other and to its hooks: the loader
 * (with its retry schedule), the residency under the `textures` budget, the binding table (which
 * draws a playing GIF's slot in place of its level, `GifPlayback.shownFor`), the uploads, and
 * the GIF playback, whose decoded frames are held back from the uploads' budget and given back
 * under pressure.
 *
 * @param options - The manager's options.
 * @param hooks - Where the parts report.
 * @returns The parts.
 */
export function createTextureManagerParts(
  options: TextureManagerOptions,
  hooks: TextureManagerHooks,
): TextureManagerParts {
  const { backend, catalogue, jobs, ledger, budget } = options;
  const texturesBytes = budget.bytesByCategory.textures;
  const loader = new LevelLoader(
    catalogue.assets,
    jobs,
    {
      onLoaded: hooks.onLoaded,
      onRetryDue: hooks.markStale,
      onDecodeQueued: hooks.markStale,
      onDecoderMissing: hooks.onDecoderMissing,
    },
    options.maxLoadsInFlight,
    new RetrySchedule(options.retryTimer),
  );
  const residency = new TextureResidency(backend, ledger, texturesBytes, hooks.onEvicted);
  const residentOf = (key: string) => residency.get(key);
  // The table and the uploads reach the playback, which is built from the uploads.
  const late: { playback?: GifPlayback } = {};
  const table = new BindingTable(
    catalogue,
    (key, id) => late.playback?.shownFor(key, id, residentOf) ?? residency.get(key),
  );
  const uploads = new LevelUploads(
    residency,
    catalogue,
    texturesBytes,
    options.uploadBytesPerFrame ?? DEFAULT_UPLOAD_BYTES_PER_FRAME,
    {
      onUploaded: hooks.onUploaded,
      onAllocationFailed: hooks.onAllocationFailed,
      onPressure: () => {
        late.playback?.relieve();
        hooks.markStale();
      },
    },
    options.atlasLoan,
  );
  const playback = new GifPlayback({
    ...options,
    residency,
    budget: uploads,
    texturesBytes,
    isMobile: budget.deviceClass === 'mobile',
    ...(options.frameTimer === undefined ? {} : { timer: options.frameTimer }),
    onChanged: hooks.onPlaybackChanged,
  });
  late.playback = playback;
  return { loader, residency, table, uploads, playback };
}
