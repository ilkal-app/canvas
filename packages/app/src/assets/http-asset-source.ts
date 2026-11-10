import {
  type AssetSource,
  type AssetTileKey,
  type ImageAssetInfo,
  type ImageAssetListener,
} from '@canvas/engine';
import type { AssetId, AssetRecord } from '@canvas/schema';

import type { LocalImage } from './asset-channel.js';
import { AssetFollower } from './asset-follower.js';
import { assetInfoOf } from './asset-info.js';
import { AssetsHttp, type AssetAccess, type AssetsFetch } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';
import { refusingOnceEnded } from './ended-fetch.js';
import type { HttpAssetSourceOptions } from './http-asset-source-options.js';
import { canDecodeAvif, decodableLevels } from './image-format-support.js';
import { withImageCapacity } from './image-read-capacity.js';
import { ProcessingReport } from './processing-report.js';
import { ReadCooldown } from './read-cooldown.js';
import { isSettledRecord } from './record-news.js';
import { RecordReads } from './record-reads.js';
import { fetchSigned, isFreshRecord, type KnownRecord } from './signed-fetch.js';
import { SignedTiles } from './signed-tiles.js';

export type { HttpAssetSourceOptions } from './http-asset-source-options.js';

/**
 * The engine's `AssetSource` over the assets service, for one board: what the
 * `AssetSource` TSDoc says the adapter owes the engine. Every request names the board and carries
 * the reader's token in its header (`AssetsHttp`); a level or the original is fetched from its
 * signed URL, read again past its lifetime (900 s, less a minute) and once more when refused, and a
 * tile from the signed URL its route answers (`SignedTiles`), so the bucket sees the page's origin;
 * an asset the board cannot read yet is described as pending (`pendingImageAssetInfo`) and followed
 * until it can (`AssetFollower`: polls, then its event stream), and `describe` rejects only for an
 * id the service calls malformed; record reads, the board's descriptions at load included, are at
 * most `MAX_RECORD_READS` in flight, the images on screen first, then those near the view
 * (`RecordReads`); AVIF levels are used where AVIF decodes here, else their WebP fallback; `signal`
 * aborts a fetch. An image the page is uploading (`addLocal`) is described from its own bytes (its
 * size, no levels, so the engine resizes the original in a job worker) and drawn at once, until its
 * record is `ready`. Nothing is logged. On the thread the engine renders on.
 */
export class HttpAssetSource implements AssetSource {
  private http: AssetsHttp;
  private readonly cooldown: ReadCooldown;
  private readonly options: HttpAssetSourceOptions;
  private readonly now: () => number;
  private readonly isAvifDecodable: Promise<boolean>;
  private readonly records = new Map<AssetId, KnownRecord>();
  private readonly locals = new Map<AssetId, LocalImage>();
  private readonly listeners = new Map<AssetId, Set<ImageAssetListener>>();
  private readonly uploads = new Set<AssetId>();
  private follower: AssetFollower | undefined;
  private visible: ReadonlySet<AssetId> = new Set();
  private isHidden = false;
  private isAvif = false;
  private readonly tiles: SignedTiles;
  private readonly reads: RecordReads;
  /** Whether the board's session ended: every request is refused before it is made. */
  private isEnded = false;
  /** The fetch every request goes through, refusing once the session ended. */
  private readonly guardedFetch: AssetsFetch;
  /** A collaborator's images on screen still processing, for the page. */
  private readonly processing: ProcessingReport;

  /**
   * Serves one board's assets.
   *
   * @param access - The service, the board and the reader's token.
   * @param options - The fetch, the clock, the AVIF capability and the page's callbacks.
   */
  constructor(access: AssetAccess, options: HttpAssetSourceOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.cooldown = new ReadCooldown(this.now);
    this.processing = new ProcessingReport(
      options.onProcessing,
      (id) => this.uploads.has(id) || this.locals.has(id),
    );
    this.guardedFetch = refusingOnceEnded(() => this.isEnded, options.fetch);
    this.http = new AssetsHttp(access, this.guardedFetch, this.cooldown);
    this.tiles = new SignedTiles({
      http: () => this.http,
      templateOf: async (assetId, signal) =>
        (await this.fresh(assetId, signal)).record.tiles?.urlTemplate,
      now: this.now,
      ...(options.requestAccess === undefined ? {} : { onUnauthorised: options.requestAccess }),
    });
    this.reads = new RecordReads(
      (assetId, signal) => this.http.record(assetId, signal),
      options.maxRecordReads,
      (ids, signal) => this.http.records(ids, signal),
    );
    this.isAvifDecodable = (options.isAvifDecodable ?? canDecodeAvif()).then((isAvif) => {
      this.isAvif = isAvif;
      return isAvif;
    });
  }

  /**
   * The board this source serves.
   *
   * @returns Its id.
   */
  get boardId(): string {
    return this.http.boardId;
  }

  /**
   * Takes a refreshed token for the same board.
   *
   * @param access - The access with the new token.
   * @throws {Error} When the access names another board; use a new source for that board.
   */
  setAccess(access: AssetAccess): void {
    if (access.boardId !== this.boardId) throw new Error('Asset access cannot switch boards.');
    this.http = new AssetsHttp(access, this.guardedFetch, this.cooldown);
  }

  /**
   * The board's session ended: its streams and polls stop, and every request, one
   * waiting to be made included, is refused before it reaches the network. What it holds stays.
   */
  endSession(): void {
    this.isEnded = true;
    this.follower?.close();
    this.follower = undefined;
    this.processing.clear();
  }

  /**
   * Draws an image from the page's own bytes while it uploads.
   *
   * @param image - The image.
   */
  addLocal(image: LocalImage): void {
    if (this.records.get(image.assetId)?.record.status === 'ready') return;
    this.locals.set(image.assetId, image);
    this.notify(image.assetId);
  }

  /**
   * Lets go of an image's local bytes (the page dropped its upload: its objects were removed).
   *
   * @param assetId - The asset.
   */
  removeLocal(assetId: AssetId): void {
    this.locals.delete(assetId);
  }

  /**
   * The page's upload of an asset verified: reads its record now and follows it, reporting its
   * status to the page until it settles.
   *
   * @param assetId - The asset.
   */
  uploaded(assetId: AssetId): void {
    this.uploads.add(assetId);
    this.ensureFollower().follow(assetId, undefined, true);
    void this.read(assetId).catch(() => undefined);
  }

  /**
   * The engine's report of the assets on screen still drawn from their placeholder, and of those
   * near the view: the visible ones' polls go first (and do not back off), and the reads of both
   * go before the rest of the board's.
   *
   * @param assetIds - The visible images' assets.
   * @param nearAssetIds - The assets of the images near the view or ahead of the pan.
   */
  setVisibleAssets(assetIds: ReadonlySet<AssetId>, nearAssetIds: ReadonlySet<AssetId>): void {
    this.visible = assetIds;
    this.reads.setPriorities(assetIds, nearAssetIds);
    this.follower?.setVisible(assetIds);
    this.processing.setVisible(assetIds);
  }

  /**
   * The engine's report that an object using an asset changed: follows it again if the follower
   * gave up on it.
   *
   * @param assetId - The asset.
   */
  revive(assetId: AssetId): void {
    this.follower?.revive(assetId);
  }

  /**
   * The page's visibility: polls pause while it is hidden.
   *
   * @param isHidden - Whether the page is hidden.
   */
  setHidden(isHidden: boolean): void {
    this.isHidden = isHidden;
    this.follower?.setHidden(isHidden);
  }

  async describe(assetId: AssetId): Promise<ImageAssetInfo> {
    await this.isAvifDecodable;
    if (this.records.has(assetId)) return this.infoOf(assetId);
    try {
      await this.read(assetId);
    } catch (error) {
      if (error instanceof AssetsHttpError && error.status === 400) throw error;
    }
    return this.infoOf(assetId);
  }

  subscribe(assetId: AssetId, listener: ImageAssetListener): () => void {
    const listeners = this.listeners.get(assetId) ?? new Set<ImageAssetListener>();
    listeners.add(listener);
    this.listeners.set(assetId, listeners);
    this.ensureFollower().follow(assetId, this.records.get(assetId)?.record);
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      this.listeners.delete(assetId);
      if (!this.uploads.has(assetId)) this.follower?.unfollow(assetId);
    };
  }

  async fetchLevel(
    assetId: AssetId,
    longEdgePx: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    await this.isAvifDecodable;
    return this.fetchSigned(assetId, signal, (record) => {
      const level = decodableLevels(record.levels, this.isAvif).find(
        (candidate) => candidate.longEdgePx === longEdgePx,
      );
      return level?.url;
    });
  }

  async fetchTile(
    assetId: AssetId,
    tile: AssetTileKey,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    return withImageCapacity(this.tiles.fetch(assetId, tile, signal));
  }

  async fetchOriginal(assetId: AssetId, signal?: AbortSignal): Promise<ArrayBuffer> {
    const local = this.locals.get(assetId);
    if (local !== undefined) {
      signal?.throwIfAborted();
      return local.file.arrayBuffer();
    }
    return this.fetchSigned(assetId, signal, (record) => record.originalUrl);
  }

  /** Stops following every asset and forgets everything (a board switch, the engine gone). */
  destroy(): void {
    this.follower?.close();
    this.follower = undefined;
    this.reads.clear();
    this.tiles.clear();
    this.listeners.clear();
    this.records.clear();
    this.locals.clear();
    this.uploads.clear();
    this.processing.clear();
  }

  /**
   * The follower, created on first need so a board whose images are all ready opens nothing.
   *
   * @returns The follower.
   */
  private ensureFollower(): AssetFollower {
    if (this.follower !== undefined) return this.follower;
    const follower = new AssetFollower({
      http: () => this.http,
      onRecord: (record) => void this.remember(record),
      now: this.now,
      ...(this.options.requestAccess === undefined
        ? {}
        : { onUnauthorised: this.options.requestAccess }),
      ...(this.options.schedule === undefined ? {} : { schedule: this.options.schedule }),
      ...(this.options.maxStreams === undefined ? {} : { maxStreams: this.options.maxStreams }),
    });
    follower.setVisible(this.visible);
    follower.setHidden(this.isHidden);
    this.follower = follower;
    return follower;
  }

  /**
   * Reads an asset's record from the service (`RecordReads`: at most `MAX_RECORD_READS` in
   * flight, on screen first) and remembers it; a refused token asks the page for a fresh one.
   *
   * @param assetId - The asset.
   * @param signal - Aborts the read.
   * @returns The record as known now.
   */
  private async read(assetId: AssetId, signal?: AbortSignal): Promise<KnownRecord> {
    try {
      return this.remember(await this.reads.read(assetId, signal));
    } catch (error) {
      if (error instanceof AssetsHttpError && error.status === 401) this.options.requestAccess?.();
      throw error;
    }
  }

  /**
   * The asset's record with signed URLs that have a while left, read again when they do not.
   *
   * @param assetId - The asset.
   * @param signal - Aborts the read.
   * @returns The record.
   */
  private async fresh(assetId: AssetId, signal?: AbortSignal): Promise<KnownRecord> {
    const known = this.records.get(assetId);
    return isFreshRecord(known, this.now()) ? known : this.read(assetId, signal);
  }

  /**
   * Fetches bytes from one of the record's signed URLs (`fetchSigned`).
   *
   * @param assetId - The asset.
   * @param signal - Aborts the fetch.
   * @param urlOf - The URL in a record.
   * @returns The bytes.
   */
  private async fetchSigned(
    assetId: AssetId,
    signal: AbortSignal | undefined,
    urlOf: (record: AssetRecord) => string | undefined,
  ): Promise<ArrayBuffer> {
    return withImageCapacity(
      fetchSigned(assetId, signal, urlOf, {
        fresh: (id, abort) => this.fresh(id, abort),
        read: (id, abort) => this.read(id, abort),
        signed: (url, abort) => this.http.signed(url, abort),
      }),
    );
  }

  /**
   * Keeps a record, tells the asset's listeners and, for the page's upload, the page; a `ready`
   * record ends drawing from the page's bytes.
   *
   * @param record - The record.
   * @returns The record as kept.
   */
  private remember(record: AssetRecord): KnownRecord {
    const known = { record, readAt: this.now() };
    this.records.set(record.id, known);
    this.follower?.learn(record);
    if (this.uploads.has(record.id)) this.options.onStatus?.(record);
    if (isSettledRecord(record)) this.uploads.delete(record.id);
    if (record.status === 'ready') this.locals.delete(record.id);
    this.processing.learn(record);
    this.notify(record.id);
    return known;
  }

  /**
   * Tells an asset's listeners its description now.
   *
   * @param assetId - The asset.
   */
  private notify(assetId: AssetId): void {
    const listeners = this.listeners.get(assetId);
    if (listeners === undefined) return;
    const info = this.infoOf(assetId);
    for (const listener of listeners) listener(info);
  }

  /**
   * An asset's description (`assetInfoOf`).
   *
   * @param assetId - The asset.
   * @returns The description.
   */
  private infoOf(assetId: AssetId): ImageAssetInfo {
    return assetInfoOf(this.records.get(assetId)?.record, this.locals.get(assetId), this.isAvif);
  }
}

/**
 * The engine's `AssetSource` over the assets service for one board: an
 * {@link HttpAssetSource}. On the thread the engine renders on.
 *
 * @param access - The service, the board and the reader's token.
 * @param options - The fetch, the clock, the AVIF capability and the page's callbacks.
 * @returns The source.
 */
export function createHttpAssetSource(
  access: AssetAccess,
  options: HttpAssetSourceOptions = {},
): HttpAssetSource {
  return new HttpAssetSource(access, options);
}
