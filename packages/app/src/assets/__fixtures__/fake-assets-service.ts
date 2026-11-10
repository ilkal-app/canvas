// An in-memory stand-in for the assets service (services/assets) behind a `fetch`,
// for the app's upload client and asset adapter tests: declarations, staged puts, completions
// that verify the hash, links between boards (proof of possession), records with signed level
// URLs that expire, tile routes, the original, and server-sent events a test drives by hand.
// Tokens are `token:<board>`; a token in a URL, or a request without one, is recorded as such.
import { createHash } from 'node:crypto';

import type { AssetId, AssetRecord } from '@canvas/schema';

import type { AssetsFetch } from '../assets-http.js';

import { FAKE_ASSETS_URL, newFakeRecord, presentFakeRecord } from './fake-asset-records.js';

export { FAKE_ASSETS_URL } from './fake-asset-records.js';

/**
 * A board's token in the fake.
 *
 * @param board - The board.
 * @returns Its token.
 */
export function fakeToken(board: string): string {
  return `token:${board}`;
}

/** One request the fake received. */
export interface FakeRequest {
  /** The whole URL, as the client built it. */
  readonly url: string;
  readonly method: string;
  readonly path: string;
  readonly board: string | null;
  readonly authorization: string | null;
  readonly isTokenInUrl: boolean;
}

interface StoredAsset {
  record: AssetRecord;
  version: number;
  bytes: Uint8Array;
}

interface StagedUpload {
  readonly assetId: AssetId;
  readonly board: string;
  bytes: Uint8Array | undefined;
}

/** A refusal the test queues for the next request to a route. */
interface QueuedFailure {
  readonly route: string;
  readonly status: number;
  readonly code: string;
  readonly retryAfterS?: number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const refuse = (status: number, code: string, retryAfterS?: number) =>
  json(
    status,
    { error: code, message: `refused: ${code}` },
    retryAfterS === undefined ? {} : { 'retry-after': String(retryAfterS) },
  );

/** The in-memory assets service. */
export class FakeAssetsService {
  readonly requests: FakeRequest[] = [];
  /** The clock signed URLs expire by, ms. */
  now = 0;
  /** Lifetime of signed URLs, ms (the service's 900 s). */
  signedUrlTtlMs = 900_000;
  private readonly assets = new Map<AssetId, StoredAsset>();
  private readonly links = new Map<AssetId, Set<string>>();
  private readonly uploads = new Map<string, StagedUpload>();
  private readonly streams = new Map<AssetId, Set<ReadableStreamDefaultController<Uint8Array>>>();
  private readonly failures: QueuedFailure[] = [];
  private nextUpload = 0;

  /**
   * The fetch the client under test uses.
   *
   * @param input - The URL.
   * @param init - The request.
   * @returns The fake's answer.
   */
  readonly fetch: AssetsFetch = (input, init) => Promise.resolve(this.handle(input, init));

  /**
   * Puts an asset on the service, linked to boards, as an earlier upload would have.
   *
   * @param bytes - The original.
   * @param boards - The boards linked to it.
   * @param status - Its status.
   * @returns Its id.
   */
  seed(
    bytes: Uint8Array,
    boards: readonly string[],
    status: AssetRecord['status'] = 'ready',
  ): AssetId {
    const assetId = createHash('sha256').update(bytes).digest('hex') as AssetId;
    this.assets.set(assetId, { record: newFakeRecord(assetId, bytes, status), version: 1, bytes });
    this.links.set(assetId, new Set(boards));
    return assetId;
  }

  /**
   * Queues a refusal for the next request whose route is `route` (`declare`, `put`, `complete`,
   * `link`, `record`, `events`, `level`, `tile` (its signed URL), `tile-object`, `original`).
   *
   * @param failure - The route and the refusal.
   */
  failNext(failure: QueuedFailure): void {
    this.failures.push(failure);
  }

  /**
   * Changes an asset's record as the pyramid job would, and sends the event to open streams
   * (ending them after `ready` or `failed`).
   *
   * @param assetId - The asset.
   * @param change - The fields that change.
   */
  update(assetId: AssetId, change: Partial<AssetRecord>): void {
    const stored = this.mustGet(assetId);
    stored.record = { ...stored.record, ...change };
    stored.version += 1;
    const { status } = stored.record;
    for (const controller of this.streams.get(assetId) ?? []) {
      controller.enqueue(this.eventBytes(stored));
      if (status === 'ready' || status === 'failed') controller.close();
    }
    if (status === 'ready' || status === 'failed') this.streams.delete(assetId);
  }

  /**
   * Ends every open stream of an asset, as a restarting service would.
   *
   * @param assetId - The asset.
   */
  dropStreams(assetId: AssetId): void {
    for (const controller of this.streams.get(assetId) ?? []) controller.close();
    this.streams.delete(assetId);
  }

  /**
   * How many event streams are open.
   *
   * @returns The count.
   */
  get openStreams(): number {
    return [...this.streams.values()].reduce((sum, set) => sum + set.size, 0);
  }

  /**
   * Whether a board is linked to an asset.
   *
   * @param assetId - The asset.
   * @param board - The board.
   * @returns True when linked.
   */
  isLinked(assetId: AssetId, board: string): boolean {
    return this.links.get(assetId)?.has(board) ?? false;
  }

  /**
   * The record as the service holds it.
   *
   * @param assetId - The asset.
   * @returns The record.
   */
  recordOf(assetId: AssetId): AssetRecord {
    return this.mustGet(assetId).record;
  }

  private mustGet(assetId: AssetId): StoredAsset {
    const stored = this.assets.get(assetId);
    if (stored === undefined) throw new Error('No such asset in the fake.');
    return stored;
  }

  /**
   * One server-sent event of a record.
   *
   * @param stored - The asset.
   * @returns The event's bytes.
   */
  private eventBytes(stored: StoredAsset): Uint8Array {
    const text = `id: ${String(stored.version)}\nevent: asset\ndata: ${JSON.stringify(presentFakeRecord(this, stored))}\n\n`;
    return new TextEncoder().encode(text);
  }

  private handle(input: string, init: RequestInit = {}): Response | Promise<Response> {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');
    const board = url.searchParams.get('board');
    this.requests.push({
      url: input,
      method,
      path: url.pathname,
      board,
      authorization,
      isTokenInUrl: url.search.includes('token'),
    });
    const route = this.routeOf(method, url.pathname);
    const failure = this.failures.findIndex(
      (queued) => queued.route === (route === 'records' ? 'record' : route),
    );
    if (failure !== -1) {
      const [queued] = this.failures.splice(failure, 1);
      if (queued !== undefined) return refuse(queued.status, queued.code, queued.retryAfterS);
    }
    if (route === 'put') return this.put(url, init);
    if (route === 'level' || route === 'original' || route === 'tile-object') {
      return this.object(url);
    }
    if (authorization !== `Bearer ${fakeToken(board ?? '')}`) return refuse(401, 'bad-signature');
    return this.api(route, url, board ?? '', init, headers);
  }

  private routeOf(method: string, path: string): string {
    if (path.startsWith('/staging/')) return 'put';
    if (path.startsWith('/objects/') && path.includes('/tiles/')) return 'tile-object';
    if (path.startsWith('/objects/')) return path.endsWith('/original') ? 'original' : 'level';
    if (path === '/assets/records') return 'records';
    if (path === '/assets') return 'declare';
    if (path.endsWith('/complete')) return 'complete';
    if (path.endsWith('/link')) return 'link';
    if (path.endsWith('/events')) return 'events';
    if (path.includes('/tiles/')) return 'tile';
    return method === 'GET' ? 'record' : 'unknown';
  }

  private api(
    route: string,
    url: URL,
    board: string,
    init: RequestInit,
    headers: Headers,
  ): Response | Promise<Response> {
    const assetId = url.pathname.split('/')[2] as AssetId;
    const body: Record<string, unknown> =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    switch (route) {
      case 'records':
        return json(200, {
          records: (body.ids as AssetId[]).map((id) =>
            this.isLinked(id, board) ? presentFakeRecord(this, this.mustGet(id)) : null,
          ),
        });
      case 'declare':
        return this.declare(board, body);
      case 'complete':
        return this.complete(assetId, board, body);
      case 'link':
        return this.link(assetId, board, body);
      case 'tile':
        return this.isLinked(assetId, board)
          ? json(200, {
              url: `${FAKE_ASSETS_URL}/objects/${assetId}/tiles/${url.pathname.split('/tiles/')[1] ?? ''}?expires=${String(this.now + this.signedUrlTtlMs)}`,
              expiresInSeconds: this.signedUrlTtlMs / 1000,
            })
          : refuse(404, 'not-found');
      case 'events':
        return this.events(assetId, board, headers);
      default:
        return this.isLinked(assetId, board)
          ? json(200, presentFakeRecord(this, this.mustGet(assetId)))
          : refuse(404, 'not-found');
    }
  }

  private declare(board: string, body: Record<string, unknown>): Response {
    const assetId = body.sha256 as AssetId;
    if (this.isLinked(assetId, board)) {
      return json(200, {
        status: 'linked',
        asset: presentFakeRecord(this, this.mustGet(assetId)),
        upload: null,
      });
    }
    const uploadId = `upload-${String((this.nextUpload += 1))}`;
    this.uploads.set(uploadId, { assetId, board, bytes: undefined });
    return json(201, {
      status: this.assets.has(assetId) ? 'exists' : 'new',
      upload: {
        id: uploadId,
        url: `${FAKE_ASSETS_URL}/staging/${uploadId}`,
        method: 'PUT',
        headers: { 'content-type': String(body.mimeType) },
      },
    });
  }

  private async put(url: URL, init: RequestInit): Promise<Response> {
    const upload = this.uploads.get(url.pathname.split('/')[2] ?? '');
    if (upload === undefined) return refuse(410, 'upload-closed');
    upload.bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
    return new Response(null, { status: 200 });
  }

  private complete(assetId: AssetId, board: string, body: Record<string, unknown>): Response {
    const upload = this.uploads.get(String(body.uploadId));
    if (upload?.assetId !== assetId || upload.board !== board) return refuse(409, 'unknown-upload');
    if (upload.bytes === undefined) return refuse(409, 'not-uploaded');
    const hash = createHash('sha256').update(upload.bytes).digest('hex');
    if (hash !== assetId) return refuse(422, 'hash-mismatch');
    this.uploads.delete(String(body.uploadId));
    if (!this.assets.has(assetId)) {
      const record = newFakeRecord(assetId, upload.bytes, 'processing');
      this.assets.set(assetId, { record, version: 1, bytes: upload.bytes });
    }
    const links = this.links.get(assetId) ?? new Set<string>();
    links.add(board);
    this.links.set(assetId, links);
    return json(202, { asset: presentFakeRecord(this, this.mustGet(assetId)) });
  }

  private link(assetId: AssetId, board: string, body: Record<string, unknown>): Response {
    const { sourceBoard, sourceToken } = body;
    if (typeof sourceBoard !== 'string' || sourceToken !== fakeToken(sourceBoard)) {
      return refuse(401, 'source-bad-signature');
    }
    if (!this.isLinked(assetId, sourceBoard)) return refuse(404, 'not-found');
    this.links.get(assetId)?.add(board);
    return json(200, { asset: presentFakeRecord(this, this.mustGet(assetId)) });
  }

  private events(assetId: AssetId, board: string, headers: Headers): Response {
    if (!this.isLinked(assetId, board)) return refuse(404, 'not-found');
    const stored = this.mustGet(assetId);
    const lastId = Number(headers.get('last-event-id') ?? '0');
    let own: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        own = controller;
        if (lastId < stored.version) controller.enqueue(this.eventBytes(stored));
        const { status } = stored.record;
        if (status === 'ready' || status === 'failed') {
          controller.close();
          return;
        }
        const set = this.streams.get(assetId) ?? new Set();
        set.add(controller);
        this.streams.set(assetId, set);
      },
      cancel: () => {
        if (own !== undefined) this.streams.get(assetId)?.delete(own);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  private object(url: URL): Response {
    const expires = Number(url.searchParams.get('expires'));
    if (!(expires > this.now)) return refuse(403, 'expired');
    const [, , assetId] = url.pathname.split('/');
    const stored = this.assets.get(assetId as AssetId);
    if (stored === undefined) return refuse(404, 'not-found');
    const bytes = url.pathname.endsWith('/original')
      ? stored.bytes
      : new Uint8Array(url.pathname.includes('/tiles/') ? [1, 2, 3] : [9]);
    return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  }
}
