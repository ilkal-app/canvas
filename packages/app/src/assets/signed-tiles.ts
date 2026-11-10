import type { AssetTileKey } from '@canvas/engine';
import type { AssetId } from '@canvas/schema';

import type { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';

/** How many tiles' signed URLs are kept, the least recently used dropped first. */
export const MAX_SIGNED_TILE_URLS = 1024;

/** How long before a signed URL expires it is signed again, ms. */
export const TILE_URL_MARGIN_MS = 60_000;

/** What {@link SignedTiles} needs. */
export interface SignedTilesOptions {
  /** The board's client now. */
  readonly http: () => AssetsHttp;
  /** The asset's tile route template (`tiles.urlTemplate`), or undefined without tiles. */
  readonly templateOf: (assetId: AssetId, signal?: AbortSignal) => Promise<string | undefined>;
  /** The clock, ms. */
  readonly now: () => number;
  /** Asks the page for a fresh token when the service refused this one (`401`). */
  readonly onUnauthorised?: () => void;
}

/** A signed URL and when it stops being used. */
interface KnownTileUrl {
  readonly url: string;
  readonly usableUntil: number;
}

/**
 * Fetches an image's tiles (fix round 1): each tile's signed URL from its route (JSON,
 * with the token in the header), then the tile from that URL directly, from the page's origin,
 * so the bucket's CORS rule (the app's origin) allows it; a redirect from the service would reach
 * the bucket with `Origin: null`. Signed URLs are kept until a minute before they expire (at most
 * {@link MAX_SIGNED_TILE_URLS}), signed again when the bucket refuses one (`403`, `404`), and a
 * `401` from the route asks the page for a fresh token. Nothing is logged. On the thread the
 * engine renders on.
 */
export class SignedTiles {
  private readonly urls = new Map<string, KnownTileUrl>();

  /**
   * Knows no tile yet.
   *
   * @param options - The client, the template, the clock and the token callback.
   */
  constructor(private readonly options: SignedTilesOptions) {}

  /**
   * Fetches one tile's bytes.
   *
   * @param assetId - The asset.
   * @param tile - The tile.
   * @param signal - Aborts the requests.
   * @returns The encoded tile.
   */
  async fetch(assetId: AssetId, tile: AssetTileKey, signal?: AbortSignal): Promise<ArrayBuffer> {
    const key = `${assetId}/${String(tile.level)}/${String(tile.column)}/${String(tile.row)}`;
    const known = this.urls.get(key);
    const isUsable = known !== undefined && this.options.now() < known.usableUntil;
    const url = isUsable ? known.url : await this.sign(key, assetId, tile, signal);
    try {
      return await this.options.http().signed(url, signal);
    } catch (error) {
      if (!(error instanceof AssetsHttpError) || (error.status !== 403 && error.status !== 404)) {
        throw error;
      }
      this.urls.delete(key);
      return this.options.http().signed(await this.sign(key, assetId, tile, signal), signal);
    }
  }

  /** Forgets every signed URL (a board switch, the engine gone). */
  clear(): void {
    this.urls.clear();
  }

  /**
   * Asks the tile's route for its signed URL and keeps it.
   *
   * @param key - The tile's key.
   * @param assetId - The asset.
   * @param tile - The tile.
   * @param signal - Aborts the request.
   * @returns The signed URL.
   * @throws {Error} When the asset has no tiles.
   */
  private async sign(
    key: string,
    assetId: AssetId,
    tile: AssetTileKey,
    signal?: AbortSignal,
  ): Promise<string> {
    const template = await this.options.templateOf(assetId, signal);
    if (template === undefined) throw new Error('The asset has no tiles.');
    const path = template
      .replace('{z}', String(tile.level))
      .replace('{x}', String(tile.column))
      .replace('{y}', String(tile.row));
    try {
      const { url, expiresInSeconds } = await this.options.http().tileUrl(path, signal);
      const usableUntil = this.options.now() + expiresInSeconds * 1000 - TILE_URL_MARGIN_MS;
      this.urls.delete(key);
      this.urls.set(key, { url, usableUntil });
      for (const oldest of this.urls.keys()) {
        if (this.urls.size <= MAX_SIGNED_TILE_URLS) break;
        this.urls.delete(oldest);
      }
      return url;
    } catch (error) {
      if (error instanceof AssetsHttpError && error.status === 401) this.options.onUnauthorised?.();
      throw error;
    }
  }
}
