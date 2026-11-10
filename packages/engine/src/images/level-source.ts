import type { AssetId } from '@canvas/schema';

import type { AssetTileKey } from './asset-source.js';

/** The asset and long edge every level source names. */
interface LevelSourceBase {
  /** The asset. */
  readonly assetId: AssetId;
  /** The level's long edge, px; a tile's longer side. */
  readonly longEdgePx: number;
}

/** A level the server made: fetched, then decoded at its own size. */
export interface ServerLevelSource extends LevelSourceBase {
  /** Always `server`. */
  readonly kind: 'server';
}

/** A level resized from the original by the client, while the server's is missing. */
export interface ClientLevelSource extends LevelSourceBase {
  /** Always `client`. */
  readonly kind: 'client';
  /** The original's media type (`ImageAssetInfo.mimeType`), for the decoder; empty to sniff. */
  readonly mimeType: string;
}

/** One tile of a tiled image. */
export interface TileLevelSource extends LevelSourceBase {
  /** Always `tile`. */
  readonly kind: 'tile';
  /** The tile. */
  readonly tile: AssetTileKey;
}

/** Where one level's pixels come from. */
export type LevelSource = ServerLevelSource | ClientLevelSource | TileLevelSource;
