import type { AssetSource, AssetTileKey, ImageAssetInfo, ImageAssetListener } from '@canvas/engine';
import type { AssetId } from '@canvas/schema';

import type { AdapterLink, LocalImage, PageAssetMessage } from './asset-channel.js';
import type { AssetAccess } from './assets-http.js';
import { HttpAssetSource, type HttpAssetSourceOptions } from './http-asset-source.js';

/** What a {@link LinkedAssetSource} takes besides its link to the page. */
export interface LinkedAssetSourceOptions extends Omit<
  HttpAssetSourceOptions,
  'requestAccess' | 'onStatus' | 'onProcessing'
> {
  /**
   * The source used while the page has no assets service (`access: null`): the harness's seeded
   * images in a harness build, else `NO_IMAGE_ASSETS` (placeholders).
   */
  readonly fallback: AssetSource;
}

/**
 * The engine's asset source in the app, on the engine's thread: it asks the page for
 * the board's access over the app's link (a `MessagePort` in the engine worker, the page's end
 * directly for a main-thread host) and serves the board's assets over HTTP
 * (`HttpAssetSource`), or through `fallback` while the page has no assets service. Calls before
 * the page answered wait for it. A token refresh keeps the board's state; a board switch ends
 * the old board's streams and caches and describes every subscribed asset again, its listeners
 * told. It tells the page the status of the assets the page uploaded, and asks for a fresh token
 * when the service refused one (once until the page answers). The engine's reports of the
 * assets on screen and of changed objects, and the page's visibility, reach the board's
 * follower, which paces its polls by them. The token lives in this object
 * and the HTTP client only, never in a URL.
 */
export class LinkedAssetSource implements AssetSource {
  private readonly link: AdapterLink;
  private readonly options: LinkedAssetSourceOptions;
  private readonly subscriptions = new Map<AssetId, Set<ImageAssetListener>>();
  private readonly unsubscribes = new Map<AssetId, () => void>();
  private readonly pendingLocals = new Map<AssetId, LocalImage>();
  /** The page's verified uploads told before the access came (a new engine). */
  private readonly pendingUploads = new Set<AssetId>();
  private readonly stopListening: () => void;
  private readonly ready: Promise<void>;
  private resolveReady: (() => void) | undefined;
  private http: HttpAssetSource | undefined;
  private visible: ReadonlySet<AssetId> = new Set();
  private near: ReadonlySet<AssetId> = new Set();
  private isHidden = false;
  private isAccessRequested = false;
  private hasAccess = false;
  private isClosed = false;
  /** Whether the board's session ended: no request, no access asked for. */
  private isEnded = false;

  /**
   * Asks the page for the board's access.
   *
   * @param link - The adapter's end of the app's link.
   * @param options - The fallback, and the HTTP source's fetch, clock, timers and capability.
   */
  constructor(link: AdapterLink, options: LinkedAssetSourceOptions) {
    this.link = link;
    this.options = options;
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.stopListening = link.listen((message) => {
      this.receive(message);
    });
    this.requestAccess();
  }

  async describe(assetId: AssetId): Promise<ImageAssetInfo> {
    await this.ready;
    return this.current.describe(assetId);
  }

  subscribe(assetId: AssetId, listener: ImageAssetListener): () => void {
    const listeners = this.subscriptions.get(assetId) ?? new Set<ImageAssetListener>();
    listeners.add(listener);
    this.subscriptions.set(assetId, listeners);
    if (!this.unsubscribes.has(assetId)) {
      void this.ready.then(() => {
        this.attach(assetId);
      });
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      this.subscriptions.delete(assetId);
      this.unsubscribes.get(assetId)?.();
      this.unsubscribes.delete(assetId);
    };
  }

  async fetchLevel(
    assetId: AssetId,
    longEdgePx: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    await this.ready;
    return this.current.fetchLevel(assetId, longEdgePx, signal);
  }

  async fetchTile(
    assetId: AssetId,
    tile: AssetTileKey,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    await this.ready;
    return this.current.fetchTile(assetId, tile, signal);
  }

  async fetchOriginal(assetId: AssetId, signal?: AbortSignal): Promise<ArrayBuffer> {
    await this.ready;
    return this.current.fetchOriginal(assetId, signal);
  }

  setVisibleAssets(assetIds: ReadonlySet<AssetId>, nearAssetIds: ReadonlySet<AssetId>): void {
    this.visible = assetIds;
    this.near = nearAssetIds;
    this.http?.setVisibleAssets(assetIds, nearAssetIds);
  }

  revive(assetId: AssetId): void {
    this.http?.revive(assetId);
  }

  /** Ends the board's streams and the link (the engine was destroyed). */
  close(): void {
    this.isClosed = true;
    this.stopListening();
    for (const unsubscribe of this.unsubscribes.values()) unsubscribe();
    this.unsubscribes.clear();
    this.http?.destroy();
    this.http = undefined;
    this.link.close();
  }

  /**
   * The source serving now: the board's over HTTP, or the fallback.
   *
   * @returns The source.
   */
  private get current(): AssetSource {
    return this.http ?? this.options.fallback;
  }

  /**
   * Follows an asset in the source serving now, for its listeners here.
   *
   * @param assetId - The asset.
   */
  private attach(assetId: AssetId): void {
    if (this.isClosed || !this.subscriptions.has(assetId) || this.unsubscribes.has(assetId)) return;
    const unsubscribe = this.current.subscribe(assetId, (info) => {
      for (const listener of this.subscriptions.get(assetId) ?? []) listener(info);
    });
    this.unsubscribes.set(assetId, unsubscribe);
  }

  /**
   * Handles a message from the page.
   *
   * @param message - The message.
   */
  private receive(message: PageAssetMessage): void {
    if (this.isClosed) return;
    switch (message.type) {
      case 'access':
        if (this.isEnded) return;
        this.isAccessRequested = false;
        this.setAccess(message.access);
        this.hasAccess = true;
        this.resolveReady?.();
        return;
      case 'local-image':
        if (this.http === undefined) this.pendingLocals.set(message.image.assetId, message.image);
        else this.http.addLocal(message.image);
        this.link.send({ type: 'local-image-held', assetId: message.image.assetId });
        return;
      case 'uploaded':
        if (this.http === undefined) this.pendingUploads.add(message.assetId);
        else this.http.uploaded(message.assetId);
        return;
      case 'forget-local':
        this.pendingLocals.delete(message.assetId);
        this.pendingUploads.delete(message.assetId);
        this.http?.removeLocal(message.assetId);
        return;
      case 'page-visibility':
        this.isHidden = message.isHidden;
        this.http?.setHidden(message.isHidden);
        return;
      case 'session-ended':
        this.isEnded = true;
        this.http?.endSession();
    }
  }

  /**
   * Takes the page's access: a new token for the same board, or another board (or none), whose
   * subscribed assets are then described and followed again.
   *
   * @param access - The access, or null without an assets service.
   */
  private setAccess(access: AssetAccess | null): void {
    const { http } = this;
    if (http !== undefined && access !== null && access.boardId === http.boardId) {
      http.setAccess(access);
      return;
    }
    if (http === undefined && access === null) return;
    for (const unsubscribe of this.unsubscribes.values()) unsubscribe();
    this.unsubscribes.clear();
    http?.destroy();
    this.http = access === null ? undefined : this.createHttp(access);
    for (const assetId of this.subscriptions.keys()) {
      this.attach(assetId);
      // The first access answers the engine's own describe; a switch must tell its listeners.
      if (this.hasAccess) void this.redescribe(assetId);
    }
  }

  /**
   * The board's HTTP source, with the page's local images added.
   *
   * @param access - The board's access.
   * @returns The source.
   */
  private createHttp(access: AssetAccess): HttpAssetSource {
    const { fetch, now, isAvifDecodable, schedule, maxStreams } = this.options;
    const source = new HttpAssetSource(access, {
      ...(fetch === undefined ? {} : { fetch }),
      ...(now === undefined ? {} : { now }),
      ...(isAvifDecodable === undefined ? {} : { isAvifDecodable }),
      ...(schedule === undefined ? {} : { schedule }),
      ...(maxStreams === undefined ? {} : { maxStreams }),
      requestAccess: () => {
        this.requestAccess();
      },
      onStatus: (record) => {
        this.link.send({
          type: 'asset-status',
          assetId: record.id,
          status: record.status,
          progress: record.progress,
        });
      },
      onProcessing: (assetIds) => {
        this.link.send({ type: 'processing', assetIds });
      },
    });
    source.setVisibleAssets(this.visible, this.near);
    source.setHidden(this.isHidden);
    for (const image of this.pendingLocals.values()) source.addLocal(image);
    this.pendingLocals.clear();
    for (const assetId of this.pendingUploads) source.uploaded(assetId);
    this.pendingUploads.clear();
    return source;
  }

  /**
   * Describes an asset again after a board switch and tells its listeners.
   *
   * @param assetId - The asset.
   */
  private async redescribe(assetId: AssetId): Promise<void> {
    const info = await this.current.describe(assetId).catch(() => undefined);
    if (info === undefined) return;
    for (const listener of this.subscriptions.get(assetId) ?? []) listener(info);
  }

  /** Asks the page for the access, once until it answers. */
  private requestAccess(): void {
    if (this.isAccessRequested || this.isClosed || this.isEnded) return;
    this.isAccessRequested = true;
    this.link.send({ type: 'access-request' });
  }
}
