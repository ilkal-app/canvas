import type { GpuTexture } from '../gpu/gpu-texture.js';
import type { DecodedLevel } from '../workers/job-kinds.js';

import type { AtlasEntry } from './image-atlas.js';
import type { PageRegion } from './image-binding.js';

/** The ledger owner of the image levels that have textures of their own. */
export const IMAGE_LEVELS_OWNER = 'image levels';

/** The ledger owner of the image atlas pages. */
export const IMAGE_ATLAS_OWNER = 'image atlas';

/** A level or tile on the GPU. */
export interface ResidentLevel {
  /** Its key. */
  readonly key: string;
  /** Its width, px. */
  readonly widthPx: number;
  /** Its height, px. */
  readonly heightPx: number;
  /** Where it is. */
  readonly region: PageRegion;
  /** The bytes evicting it frees: its texture's, or its share of an atlas page. */
  readonly bytes: number;
  /** Its atlas entry, for a small level or a tile. */
  readonly entry: AtlasEntry | undefined;
  /** Its own texture, for a large level. */
  readonly texture: GpuTexture | undefined;
  /** The last frame that needed or drew it. */
  lastUsedFrame: number;
}

/** Why an upload did not happen. */
export type UploadRefusal = 'over-budget' | 'allocation-failed' | 'too-large';

/**
 * A level with a texture of its own, once its texture is a page.
 *
 * @param key - Its key.
 * @param level - Its pixels.
 * @param texture - Its texture.
 * @param page - The `TexturePages` page of its texture.
 * @param frameIndex - The frame, as its last use.
 * @returns The resident level, whose region is the whole page.
 */
export function textureLevelOf(
  key: string,
  level: DecodedLevel,
  texture: GpuTexture,
  page: number,
  frameIndex: number,
): ResidentLevel {
  const { widthPx, heightPx } = level;
  return {
    key,
    widthPx,
    heightPx,
    region: { page, u0: 0, v0: 0, u1: 1, v1: 1 },
    bytes: widthPx * heightPx * 4,
    entry: undefined,
    texture,
    lastUsedFrame: frameIndex,
  };
}

/**
 * A level or tile on an atlas page, drawn from the top-left corner of its entry.
 *
 * @param key - Its key.
 * @param entry - Its rectangle on a page.
 * @param level - Its pixels.
 * @param frameIndex - The frame, as its last use.
 * @param pageSize - The atlas page's edge, texels.
 * @returns The resident level.
 */
export function atlasLevelOf(
  key: string,
  entry: AtlasEntry,
  level: DecodedLevel,
  frameIndex: number,
  pageSize: number,
): ResidentLevel {
  const { widthPx, heightPx } = level;
  return {
    key,
    widthPx,
    heightPx,
    region: {
      page: entry.page,
      u0: entry.x / pageSize,
      v0: entry.y / pageSize,
      u1: (entry.x + widthPx) / pageSize,
      v1: (entry.y + heightPx) / pageSize,
    },
    bytes: widthPx * heightPx * 4,
    entry,
    texture: undefined,
    lastUsedFrame: frameIndex,
  };
}

/**
 * Views decoded pixels as the backend's upload type (a view over an `ArrayBuffer`).
 *
 * @param rgba - The pixels.
 * @returns A view of the same bytes.
 */
export function asArrayBufferView(rgba: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength);
}
