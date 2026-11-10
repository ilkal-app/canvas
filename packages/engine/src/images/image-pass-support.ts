import type { AssetId } from '@canvas/schema';

import { AssetCatalogue } from './asset-catalogue.js';
import type { AssetSource } from './asset-source.js';
import type { ImageJobRunner } from './level-loader.js';
import type { TextureManager } from './texture-manager.js';

/**
 * What the image pass loads with (the scene pass environment's `images`): the asset catalogue,
 * which outlives a lost device with its CPU copies of the smallest levels, and the pool that
 * runs `decode` jobs. The engine host makes one per engine (`createImagePassSupport`).
 */
export interface ImagePassSupport {
  /** Descriptions and the smallest levels' pixels, by asset; wraps the `AssetSource`. */
  readonly catalogue: AssetCatalogue;
  /** Where `decode` jobs run. */
  readonly jobs: ImageJobRunner;
  /**
   * Told of each texture manager an image pass builds (one per renderer, a new one after a lost
   * device): golden scenes and tests wait on its `isIdle` and read its `shownKeys`.
   */
  readonly onManager?: (manager: TextureManager) => void;
  /**
   * Reports that no job worker can decode images (none was started, or all were retired): once
   * per engine, however many loads fail, through the engine's fault channel.
   *
   * @param error - The pool's error.
   */
  readonly reportDecoderMissing: (error: Error) => void;
}

/**
 * Makes the image pass's support for one engine.
 *
 * @param assets - Where descriptions and bytes come from.
 * @param jobs - The pool that decodes.
 * @param maxTextureSize - The GPU's largest texture edge, px.
 * @param onFault - The engine's fault channel: told once when no job worker can decode images.
 * @returns The support.
 */
export function createImagePassSupport(
  assets: AssetSource,
  jobs: ImageJobRunner,
  maxTextureSize: number,
  onFault?: (error: Error) => void,
): ImagePassSupport {
  let isReported = false;
  const reportDecoderMissing = (error: Error): void => {
    if (isReported) return;
    isReported = true;
    onFault?.(
      new Error(
        `Images cannot be decoded: no job worker is running and images are never decoded on the rendering thread (${error.message}).`,
      ),
    );
  };
  return { catalogue: new AssetCatalogue(assets, maxTextureSize), jobs, reportDecoderMissing };
}

function unknownAsset(assetId: AssetId): Promise<never> {
  return Promise.reject(new Error(`No asset source can load ${assetId}.`));
}

/**
 * The asset source of an engine given none: every asset is unknown, so images keep their
 * placeholder colour.
 */
export const NO_IMAGE_ASSETS: AssetSource = {
  describe: unknownAsset,
  fetchLevel: unknownAsset,
  fetchTile: unknownAsset,
  fetchOriginal: unknownAsset,
  subscribe: () => () => undefined,
};
