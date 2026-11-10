import type { AssetId } from '@canvas/schema';

import type { DecodedLevel } from '../workers/job-kinds.js';

import type { ImageAssetInfo } from './asset-source.js';
import type { AssetView } from './image-needs.js';

/** What the texture manager knows of one asset. */
export interface CatalogueEntry {
  /** The asset. */
  readonly assetId: AssetId;
  /**
   * `describing` until the source answers with the image's size and at least one level it can
   * show, then `described`, or `failed`. A pending description (no size yet, or a tiled image
   * before its first server level) keeps `describing`.
   */
  status: 'describing' | 'described' | 'failed';
  /** Its description, once described. */
  info: ImageAssetInfo | undefined;
  /** The long edges it can show, smallest first: server levels, or levels the client resizes. */
  levels: readonly number[];
  /** What the planner reads of it, once described (`assetView`). */
  view: AssetView | undefined;
  /**
   * A CPU copy of its smallest level's pixels, kept once decoded: the level every visible image
   * always has, re-uploaded at once when it was evicted or the device was
   * lost. Its presence makes the asset ready.
   */
  smallest: DecodedLevel | undefined;
  /**
   * Whether its smallest level was decoded: sticky across copy-cap eviction, so blanks stay
   * visible to diagnostics. A failed restored description resets it when possession is unproven.
   */
  hasBeenReady: boolean;
  /** Stops listening for new levels. */
  unsubscribe: (() => void) | undefined;
}

/**
 * Whether an entry is a described GIF: an asset that may play (`GifPlayback`).
 *
 * @param entry - The entry.
 * @returns True for a described `image/gif`.
 */
export function isDescribedGif(entry: CatalogueEntry | undefined): boolean {
  return entry?.status === 'described' && entry.info?.mimeType.toLowerCase() === 'image/gif';
}
