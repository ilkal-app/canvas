import type { AssetId, AssetRecord, AssetTiles } from '@canvas/schema';

/**
 * The part of an image's tile pyramid (`AssetTiles` of `@canvas/schema`) the tile arithmetic
 * reads: tile level `z`, from 0 to `levels − 1`, is the original scaled by `2^(z − levels + 1)`,
 * so the last level is full resolution, cut into `tileSizePx` tiles from the top left (the last
 * column and row may be narrower).
 */
export type ImageAssetTiles = Pick<AssetTiles, 'tileSizePx' | 'levels'>;

/**
 * What the engine reads of an image asset: the part of the assets
 * service's record (`AssetRecord` of `@canvas/schema`) that says its original's media
 * type and size, the resized levels made so far (an AVIF level may be listed with its WebP
 * fallback at the same long edge), its tile pyramid and its placeholder, so the app's adapter
 * passes records through. Until the service has read the image, `naturalSize`,
 * `averageColor` and `blurhash` are null and the image shows a neutral placeholder; `levels`
 * grows as the service works, and `AssetSource.subscribe` reports each new version.
 */
export type ImageAssetInfo = Pick<
  AssetRecord,
  'mimeType' | 'naturalSize' | 'levels' | 'tiles' | 'averageColor' | 'blurhash'
>;

/**
 * A description of an asset the source cannot describe yet: an upload the
 * board is not linked to until it verifies, or an image the service has not read. No size and no
 * levels, so its images show a neutral placeholder and nothing is fetched; the source replaces it
 * through `AssetSource.subscribe` once it knows more, however long that takes.
 *
 * @param mimeType - The original's media type, when known; empty to let the decoder sniff it.
 * @returns The description.
 */
export function pendingImageAssetInfo(mimeType = ''): ImageAssetInfo {
  return {
    mimeType,
    naturalSize: null,
    levels: [],
    tiles: null,
    averageColor: null,
    blurhash: null,
  };
}

/** One tile of an asset's tile pyramid (`ImageAssetTiles`): its level, column and row. */
export interface AssetTileKey {
  /** The tile level, 0 the coarsest. */
  readonly level: number;
  /** The column, from 0 at the left. */
  readonly column: number;
  /** The row, from 0 at the top. */
  readonly row: number;
}

/**
 * Called when an asset's description changes, typically because the server produced another
 * level.
 *
 * @param info - The new description.
 */
export type ImageAssetListener = (info: ImageAssetInfo) => void;

/**
 * The engine's only view of image assets: descriptions and encoded
 * bytes, by asset id. The engine never sees HTTP, URLs or the asset record; the app adapts the
 * assets service's records to this interface, and tests, golden scenes and benchmarks
 * use `createFixtureAssetSource`. Every method may be called from the thread that renders; the
 * bytes it returns are handed to a `decode` job, never decoded on that thread.
 *
 * What the adapter owes the engine:
 * - **Board and token on every URL.** Every request names the board and carries the reader's
 *   token; the engine passes neither.
 * - **Signed URLs expire after 900 s.** A fetch whose signed URL has expired (or is about to)
 *   refreshes it inside the fetch and retries once, so a level asked for after a long idle
 *   still loads; the engine retries a failed fetch only a few times (about 7.5 s in all).
 * - **Pending descriptions, never early rejections.** An asset the board is not linked to yet
 *   (its upload has not verified; a collaborator's image object can arrive long before) or that
 *   the service has not read resolves `describe` with a pending description
 *   (`pendingImageAssetInfo`: no size, no levels) and later reports the real one through
 *   `subscribe`. A rejection means the asset is unknown for good; the engine describes it again
 *   only when an object using it is seen again.
 * - **One follower per board, multiplexed.** `subscribe` listeners of every asset share the
 *   board's follower (the service's event streams, opened lazily on the first `subscribe`, and
 *   polls for what the board cannot read yet), and an asset's following ends once it is
 *   `ready` or `failed`: no new level will appear.
 * - **Format by decoder capability.** `fetchLevel` and `fetchTile` return AVIF where the job
 *   workers' `createImageBitmap` decodes it (capability detection, not the user agent) and the
 *   WebP fallback elsewhere.
 * - **Honour `signal`.** An aborted fetch stops its request and rejects; the engine has already
 *   given its slot to a more urgent level.
 * - **Never log URLs.** They carry tokens and signatures.
 */
export interface AssetSource {
  /**
   * Optional explicit attestation of immutable asset content, provided only by a trusted adapter.
   * The token attests immutable original content AND stable encoded bytes for every level/tile
   * selector and decoder format this adapter serves. Reprocessing, changed encoders or mutable
   * URLs require a new token before any fetch. An original SHA alone is insufficient. Repeated
   * requests under the same token and selector must produce identical rendition bytes.
   * Absence, an empty token or a throwing provider disables preview proof; a hex ID or a
   * successful description alone is not proof. Does not attest residency or selected resolution.
   *
   * @param assetId - Asset whose authenticated content identity is already established.
   * @returns Immutable content token, or undefined while not proven.
   */
  immutableContentIdentity?(assetId: AssetId): string | undefined;

  /**
   * Describes an asset: its record now, or a pending description (`pendingImageAssetInfo`)
   * while the board is not linked to it or the service has not read it.
   *
   * @param assetId - The asset.
   * @returns Its description; rejects only when the asset is unknown for good.
   */
  describe(assetId: AssetId): Promise<ImageAssetInfo>;
  /**
   * Fetches one server-made level, encoded: the adapter picks AVIF where the job workers'
   * `createImageBitmap` decodes it and the level's WebP fallback elsewhere (capability
   * detection, not the user agent).
   *
   * @param assetId - The asset.
   * @param longEdgePx - The level's long edge, one of `ImageAssetInfo.levels`.
   * @param signal - Aborted when the engine no longer wants the level: stop and reject.
   * @returns The encoded bytes; rejects when the level does not exist or the fetch was aborted.
   */
  fetchLevel(assetId: AssetId, longEdgePx: number, signal?: AbortSignal): Promise<ArrayBuffer>;
  /**
   * Fetches one tile of the asset's tile pyramid, encoded.
   *
   * @param assetId - The asset.
   * @param tile - The tile.
   * @param signal - Aborted when the engine no longer wants the tile: stop and reject.
   * @returns The encoded bytes; rejects when the asset has no such tile or the fetch was aborted.
   */
  fetchTile(assetId: AssetId, tile: AssetTileKey, signal?: AbortSignal): Promise<ArrayBuffer>;
  /**
   * Fetches the original file, which a `decode` job resizes to the levels the server has not
   * made yet and, for an
   * untiled image of at most 4096 px, decodes at its own size as the top level.
   *
   * @param assetId - The asset.
   * @param signal - Aborted when the engine no longer wants it: stop and reject.
   * @returns The encoded original; rejects when the fetch was aborted.
   */
  fetchOriginal(assetId: AssetId, signal?: AbortSignal): Promise<ArrayBuffer>;
  /**
   * Listens for changes to an asset's description, such as a level appearing or a pending
   * description becoming known.
   *
   * @param assetId - The asset.
   * @param listener - Called with each new description.
   * @returns Stops listening.
   */
  subscribe(assetId: AssetId, listener: ImageAssetListener): () => void;
  /**
   * Optional: the assets of the images on screen still drawn from their placeholder, and of
   * those near the view or ahead of the pan (the texture manager's padded and prefetch regions),
   * reported by the texture manager whenever either set changes, so an adapter that paces its
   * requests (a poll budget across a board's pending assets, a cap on the descriptions in
   * flight) serves the visible ones first and the near ones next.
   *
   * @param assetIds - The visible images' assets; the set is not changed after the call.
   * @param nearAssetIds - The near and prefetch images' assets, none of them visible; the set is
   *   not changed after the call.
   */
  setVisibleAssets?(assetIds: ReadonlySet<AssetId>, nearAssetIds: ReadonlySet<AssetId>): void;
  /**
   * Optional: an image object using the asset changed while its description is still pending,
   * so an adapter that gave up following the asset follows it again.
   *
   * @param assetId - The asset.
   */
  revive?(assetId: AssetId): void;
}
