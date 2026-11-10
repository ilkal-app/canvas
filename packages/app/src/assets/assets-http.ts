import type { AssetId, AssetRecord } from '@canvas/schema';

import type {
  AssetAccess,
  AssetsFetch,
  Declaration,
  DeclaredImage,
  LinkPreview,
} from './assets-request-types.js';
import { AssetsHttpError, field, recordOf, refusal, retryAfterOf } from './assets-responses.js';
import { ReadCooldown } from './read-cooldown.js';
import { EventStreamParser } from './server-sent-events.js';

export type {
  AssetAccess,
  AssetsFetch,
  Declaration,
  DeclaredImage,
  LinkPreview,
} from './assets-request-types.js';

/**
 * The assets service's HTTP API as the page and the engine's adapter call it (as
 * the service documents it): the record, its events, declaring, completing and linking an
 * upload, tiles' signed URLs, and the bytes behind signed URLs. Every `/assets` request names the
 * board in `board=` and carries the token in `Authorization: Bearer`; a signed URL is fetched
 * without the token, which it does not need. Any thread with `fetch`.
 */
export class AssetsHttp {
  private readonly access: AssetAccess;
  private readonly fetch: AssetsFetch;

  /**
   * Talks to one board's assets.
   *
   * @param access - The service, the board and the token.
   * @param fetchFunction - The fetch to use; the thread's own if absent.
   * @param cooldown - Shared read deadline, retained across token refresh.
   */
  constructor(
    access: AssetAccess,
    fetchFunction?: AssetsFetch,
    private readonly cooldown = new ReadCooldown(),
  ) {
    this.access = access;
    this.fetch = fetchFunction ?? ((input, init) => fetch(input, init));
  }

  /**
   * The board this client acts for.
   *
   * @returns Its id.
   */
  get boardId(): string {
    return this.access.boardId;
  }

  /**
   * Remaining server-directed read wait; mutating requests are not delayed.
   *
   * @returns The remaining wait in milliseconds.
   */
  get readWaitMs(): number {
    return this.cooldown.remainingMs;
  }

  /**
   * `GET /assets/:id`: the asset's record, with fresh signed URLs.
   *
   * @param assetId - The asset.
   * @param signal - Aborts the request.
   * @returns The record; rejects with `404` while the board is not linked to it.
   */
  async record(assetId: AssetId, signal?: AbortSignal): Promise<AssetRecord> {
    return recordOf(await this.json(`/assets/${assetId}`, { signal }));
  }

  /**
   * Reads up to fifty asset records in one authenticated request, preserving null refusals.
   *
   * @param assetIds - IDs in caller order, including duplicates.
   * @param signal - Aborts the request.
   * @returns Matching records or null for unknown/unlinked assets, in request order.
   * @throws {AssetsHttpError} When the request or its response is invalid or refused.
   */
  async records(
    assetIds: readonly AssetId[],
    signal?: AbortSignal,
  ): Promise<(AssetRecord | null)[]> {
    const ids = [...assetIds];
    if (ids.length < 1 || ids.length > 50)
      throw new AssetsHttpError(
        0,
        'invalid-batch',
        'An asset batch must contain one to fifty IDs.',
      );
    const body = await this.json('/assets/records', { method: 'POST', body: { ids }, signal });
    const records = field(body, 'records');
    if (
      typeof body !== 'object' ||
      body === null ||
      Object.keys(body).length !== 1 ||
      !Array.isArray(records) ||
      records.length !== ids.length
    )
      throw new AssetsHttpError(0, 'invalid-batch', 'The assets service sent an invalid batch.');
    return (records as unknown[]).map((value, index) => {
      if (value === null) return null;
      const record = recordOf(value);
      if (record.id !== ids[index])
        throw new AssetsHttpError(
          0,
          'invalid-batch',
          'The assets service sent a mismatched record.',
        );
      return record;
    });
  }

  /**
   * `POST /assets`: declares an upload of an image's bytes.
   *
   * @param image - The asset id, byte length and media type.
   * @returns Where to put the bytes, or that the board is already linked.
   */
  async declare(image: DeclaredImage): Promise<Declaration> {
    const body = await this.json('/assets', {
      method: 'POST',
      body: { sha256: image.assetId, byteLength: image.byteLength, mimeType: image.mimeType },
    });
    const status = field(body, 'status');
    if (status === 'linked') return { status, asset: recordOf(field(body, 'asset')) };
    const upload = field(body, 'upload');
    const [uploadId, url, headers] = ['id', 'url', 'headers'].map((key) => field(upload, key));
    if (
      (status !== 'new' && status !== 'exists') ||
      typeof uploadId !== 'string' ||
      typeof url !== 'string' ||
      typeof headers !== 'object' ||
      headers === null
    ) {
      throw new AssetsHttpError(0, 'invalid-declaration', 'The assets service sent no upload.');
    }
    return { status, uploadId, url, headers: headers as Record<string, string> };
  }

  /**
   * `POST /assets/:id/complete`: asks the service to verify the put bytes against the hash,
   * which links the board.
   *
   * @param assetId - The asset.
   * @param uploadId - The upload whose bytes were put.
   * @returns The asset's record.
   */
  async complete(assetId: AssetId, uploadId: string): Promise<AssetRecord> {
    const body = await this.json(`/assets/${assetId}/complete`, {
      method: 'POST',
      body: { uploadId },
    });
    return recordOf(field(body, 'asset'));
  }

  /**
   * `POST /assets/:id/link`: links an asset another board may read to this board (a paste
   * between boards, owner-confirmed proof of possession): the source board's token goes in the
   * body, this board's in the header.
   *
   * @param assetId - The asset.
   * @param sourceBoard - The board it was copied from.
   * @param sourceToken - A token for that board.
   * @returns The asset's record.
   */
  async link(assetId: AssetId, sourceBoard: string, sourceToken: string): Promise<AssetRecord> {
    const body = await this.json(`/assets/${assetId}/link`, {
      method: 'POST',
      body: { sourceBoard, sourceToken },
    });
    return recordOf(field(body, 'asset'));
  }

  /**
   * `POST /assets/from-link` with `{ url }`: the service fetches the image a link names
   * (every hop SSRF-checked) and takes it in as an upload from the board, linking it.
   *
   * @param url - The link the person pasted.
   * @param signal - Aborts the request.
   * @returns The asset's record (its size may be null until the service has read it).
   * @throws {AssetsHttpError} With the service's code (`private-address`, `not-an-image`,
   *   `too-large`, `timeout`…) when refused.
   */
  async fromLink(url: string, signal?: AbortSignal): Promise<AssetRecord> {
    const body = await this.json('/assets/from-link', { method: 'POST', body: { url }, signal });
    return recordOf(field(body, 'asset'));
  }

  /**
   * `POST /v1/links/unfurl` with `{ url, boardId }`: the service fetches a pasted link's
   * page (every hop SSRF-checked) and answers its preview, its image and icon taken in as assets.
   *
   * @param url - The link the person pasted.
   * @param signal - Aborts the request.
   * @returns The preview.
   * @throws {AssetsHttpError} With the page's problem as the code when it could not be had.
   */
  async unfurl(url: string, signal?: AbortSignal): Promise<LinkPreview> {
    const body = { url, boardId: this.boardId };
    return (await this.json('/v1/links/unfurl', { method: 'POST', body, signal })) as LinkPreview;
  }

  /**
   * `GET /assets/:id/events`: follows the record's server-sent events until the stream ends
   * (after `ready` or `failed`) or `signal` aborts it, with the token in the header (so the
   * stream is read with `fetch`, not `EventSource`). No `Last-Event-ID` is sent: every stream
   * starts with the whole record, so there is nothing to resume, and the header is not one the
   * service's CORS allows.
   *
   * @param assetId - The asset.
   * @param onRecord - Called with each record, in order.
   * @param signal - Ends the stream.
   * @returns Settles when the stream ends.
   */
  async events(
    assetId: AssetId,
    onRecord: (record: AssetRecord) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.send(`/assets/${assetId}/events`, {
      signal,
      headers: { accept: 'text/event-stream' },
    });
    if (response.body === null) return;
    const parser = new EventStreamParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    signal?.addEventListener('abort', () => {
      void reader.cancel().catch(() => undefined);
    });
    for (;;) {
      const { done: isDone, value } = await reader.read();
      if (isDone) return;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (event.event === 'asset') onRecord(recordOf(JSON.parse(event.data)));
      }
    }
  }

  /**
   * The signed URL of one tile, from its route (`tiles.urlTemplate`, filled in), with the board
   * and the token in the header: JSON, not a redirect, which would reach the bucket with `Origin:
   * null` (fix round 1). The tile is then fetched from the URL with `signed`.
   *
   * @param path - The tile route's URL or path.
   * @param signal - Aborts the request.
   * @returns The signed URL (the bucket's origin) and how long it lives from now, seconds.
   * @throws {AssetsHttpError} When refused, or when the answer names no URL.
   */
  async tileUrl(
    path: string,
    signal?: AbortSignal,
  ): Promise<{
    /** The tile's signed URL. */
    readonly url: string;
    /** How long it stays valid, seconds. */
    readonly expiresInSeconds: number;
  }> {
    const body = await this.json(path, { signal });
    const url = field(body, 'url');
    const expiresInSeconds = field(body, 'expiresInSeconds');
    if (typeof url !== 'string' || typeof expiresInSeconds !== 'number') {
      throw new AssetsHttpError(0, 'invalid-tile', 'The assets service sent no tile URL.');
    }
    return { url, expiresInSeconds };
  }

  /**
   * Fetches bytes from a signed URL (a level, a tile, the original), without the token.
   *
   * @param url - The signed URL.
   * @param signal - Aborts the fetch.
   * @returns The bytes.
   * @throws {AssetsHttpError} When refused (an expired signature is `403`).
   */
  async signed(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const response = await this.request(url, signal === undefined ? {} : { signal });
    if (!response.ok) return refusal(response);
    return response.arrayBuffer();
  }

  /**
   * Sends a request to the API and reads its JSON answer.
   *
   * @param path - The route, from the service's base URL.
   * @param options - The method, body and signal.
   * @param options.method - The method; `GET` if absent.
   * @param options.body - A JSON body.
   * @param options.signal - Aborts the request.
   * @returns The parsed answer.
   */
  private async json(
    path: string,
    options: {
      readonly method?: string;
      readonly body?: unknown;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<unknown> {
    const response = await this.send(path, {
      ...(options.method === undefined ? {} : { method: options.method }),
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } }),
      signal: options.signal,
    });
    return response.json();
  }

  /**
   * Sends a request to the API with the board and the token, refusing an answer that is not OK
   * and a URL on any other origin than the service's (the token never leaves for another host).
   *
   * @param path - The route (or the URL of one on the service).
   * @param init - The request's method, headers, body and signal.
   * @param init.signal - Aborts the request.
   * @returns The response.
   */
  private async send(
    path: string,
    init: Omit<RequestInit, 'signal' | 'headers'> & {
      readonly signal: AbortSignal | undefined;
      readonly headers?: Record<string, string>;
    },
  ): Promise<Response> {
    init.signal?.throwIfAborted();
    const isRead = (init.method ?? 'GET') === 'GET' || path === '/assets/records';
    if (isRead) this.cooldown.check();
    const service = new URL(this.access.assetsUrl);
    const url = new URL(path, service);
    // The token goes only to the service itself, whatever URL a record names.
    if (url.origin !== service.origin) {
      throw new AssetsHttpError(0, 'foreign-url', 'An asset URL named another host.');
    }
    url.searchParams.set('board', this.access.boardId);
    const { signal, headers, ...rest } = init;
    const response = await this.request(url.toString(), {
      ...rest,
      ...(signal === undefined ? {} : { signal }),
      headers: { ...headers, authorization: `Bearer ${this.access.token}` },
    });
    if (!response.ok) {
      if (isRead && response.status === 429)
        this.cooldown.observe(
          new AssetsHttpError(429, 'rate-limited', 'Read capacity wait.', retryAfterOf(response)),
        );
      return refusal(response);
    }
    return response;
  }

  /**
   * Fetches, turning a request that got no answer into an {@link AssetsHttpError} of status 0
   * (an abort stays an abort).
   *
   * @param url - The URL.
   * @param init - The request.
   * @returns The response.
   */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, init);
    } catch (error) {
      if (init.signal?.aborted === true) throw error;
      throw new AssetsHttpError(0, 'network', 'The assets service could not be reached.');
    }
  }
}
