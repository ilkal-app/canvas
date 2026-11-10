import { pendingImageAssetInfo, type ImageAssetInfo } from '@canvas/engine';
import type { AssetRecord } from '@canvas/schema';

import type { LocalImage } from './asset-channel.js';
import { decodableLevels, decodableTiles } from './image-format-support.js';

/**
 * An asset's description for the engine: its record's, with only the formats that decode here,
 * and the page's own size of an image it is uploading while the service has not read it; pending
 * otherwise (`pendingImageAssetInfo`). Pure.
 *
 * @param record - Its record, if the board read one.
 * @param local - The page's own bytes of it, while the page uploads it.
 * @param isAvif - Whether AVIF decodes here.
 * @returns The description.
 */
export function assetInfoOf(
  record: AssetRecord | undefined,
  local: LocalImage | undefined,
  isAvif: boolean,
): ImageAssetInfo {
  if (record === undefined) {
    const pending = pendingImageAssetInfo(local?.mimeType);
    return local === undefined ? pending : { ...pending, naturalSize: { ...local.naturalSize } };
  }
  return {
    mimeType: record.mimeType,
    naturalSize: record.naturalSize ?? (local === undefined ? null : { ...local.naturalSize }),
    levels: decodableLevels(record.levels, isAvif),
    tiles: decodableTiles(record.tiles, isAvif),
    averageColor: record.averageColor,
    blurhash: record.blurhash,
  };
}
