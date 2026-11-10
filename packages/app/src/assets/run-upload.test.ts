import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';
import type { PreparedImage } from './prepare-image.js';
import { runUpload, uploadFailureMessage, type PutFile } from './run-upload.js';
import { QUEUED_UPLOAD, stepUpload, type UploadEvent } from './upload-state.js';

const BYTES = new Uint8Array([4, 5, 6, 7]);
const IMAGE: PreparedImage = {
  assetId: createHash('sha256').update(BYTES).digest('hex') as AssetId,
  naturalSize: { width: 2, height: 2 },
  mimeType: 'image/png',
  byteLength: BYTES.length,
};

/**
 * An upload against the fake, recording its events and waits.
 *
 * @param service - The fake.
 * @param board - The board.
 * @param signal - Stops the upload.
 * @returns What to run and what it recorded.
 */
function uploading(service: FakeAssetsService, board = 'board-a', signal?: AbortSignal) {
  const events: UploadEvent[] = [];
  const waits: number[] = [];
  let refreshes = 0;
  let token = fakeToken(board);
  const put: PutFile = async (url, headers, body, onProgress) => {
    onProgress(body.size / 2, body.size);
    const response = await service.fetch(url, { method: 'PUT', body, headers });
    if (!response.ok) {
      // As the page's put reads a store's 403: its signed URL expired.
      const code = response.status === 403 ? 'put-expired' : 'put-refused';
      throw new AssetsHttpError(response.status, code, 'refused');
    }
    onProgress(body.size, body.size);
  };
  const run = () =>
    runUpload(IMAGE, new Blob([BYTES], { type: 'image/png' }), {
      http: () =>
        new AssetsHttp({ assetsUrl: FAKE_ASSETS_URL, boardId: board, token }, service.fetch),
      put,
      wait: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
      refreshAccess: () => {
        refreshes += 1;
        token = fakeToken(board);
        return Promise.resolve();
      },
      onEvent: (event) => events.push(event),
      ...(signal === undefined ? {} : { signal }),
    });
  return {
    run,
    events,
    waits,
    refreshes: () => refreshes,
    spoilToken: () => {
      token = 'nonsense';
    },
    state: () => events.reduce(stepUpload, QUEUED_UPLOAD),
  };
}

describe('runUpload', () => {
  it('declares, puts with progress and completes, which links the board', async () => {
    const service = new FakeAssetsService();
    const upload = uploading(service);
    await upload.run();
    expect(upload.events.map((event) => event.type)).toEqual([
      'start',
      'sent',
      'sent',
      'sent-all',
      'record',
    ]);
    expect(upload.state()).toMatchObject({ phase: 'processing', attempts: 1 });
    expect(service.isLinked(IMAGE.assetId, 'board-a')).toBe(true);
  });

  it('skips the put for a board already linked', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a']);
    const upload = uploading(service);
    await upload.run();
    expect(upload.state().phase).toBe('ready');
    expect(service.requests.some(({ path }) => path.startsWith('/staging/'))).toBe(false);
  });

  it('proves possession of an asset another board uploaded by putting the bytes again', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-b']);
    const upload = uploading(service);
    await upload.run();
    expect(service.requests.some(({ path }) => path.startsWith('/staging/'))).toBe(true);
    expect(service.isLinked(IMAGE.assetId, 'board-a')).toBe(true);
  });

  it('waits out Retry-After while busy, then gives up with a sentence', async () => {
    const service = new FakeAssetsService();
    service.failNext({ route: 'declare', status: 429, code: 'rate-limited', retryAfterS: 2 });
    service.failNext({ route: 'complete', status: 429, code: 'busy', retryAfterS: 1 });
    const upload = uploading(service);
    await upload.run();
    expect(upload.waits).toEqual([2000, 1000]);
    expect(upload.state().phase).toBe('processing');
    const busy = new FakeAssetsService();
    for (let index = 0; index < 4; index += 1) {
      busy.failNext({ route: 'declare', status: 503, code: 'completion-timeout' });
    }
    const failing = uploading(busy);
    await failing.run();
    expect(failing.waits).toEqual([1000, 1000, 1000]);
    expect(failing.state()).toMatchObject({
      phase: 'failed',
      failure: 'The server is busy. Try again later.',
    });
  });

  it('asks for a fresh token once after a 401', async () => {
    const service = new FakeAssetsService();
    const upload = uploading(service);
    upload.spoilToken();
    await upload.run();
    expect(upload.refreshes()).toBe(1);
    expect(upload.state().phase).toBe('processing');
  });

  it('starts over once when the completion says the stage changed', async () => {
    const service = new FakeAssetsService();
    service.failNext({ route: 'complete', status: 409, code: 'upload-changed' });
    const upload = uploading(service);
    await upload.run();
    expect(service.requests.filter(({ path }) => path === '/assets')).toHaveLength(2);
    expect(upload.state().phase).toBe('processing');
    const twice = new FakeAssetsService();
    twice.failNext({ route: 'complete', status: 422, code: 'hash-mismatch' });
    twice.failNext({ route: 'complete', status: 422, code: 'hash-mismatch' });
    const failing = uploading(twice);
    await failing.run();
    expect(failing.state()).toMatchObject({ phase: 'failed', failure: 'The upload failed.' });
  });

  it('declares again once when the store refuses a signed URL that expired during the put', async () => {
    const service = new FakeAssetsService();
    service.failNext({ route: 'put', status: 403, code: 'expired' });
    const upload = uploading(service);
    await upload.run();
    expect(service.requests.filter(({ path }) => path === '/assets')).toHaveLength(2);
    expect(upload.state().phase).toBe('processing');
  });

  it('reports nothing for an upload stopped by the page', async () => {
    const service = new FakeAssetsService();
    service.failNext({ route: 'put', status: 500, code: 'broken' });
    const controller = new AbortController();
    controller.abort();
    const upload = uploading(service, 'board-a', controller.signal);
    await upload.run();
    expect(upload.events.some(({ type }) => type === 'error')).toBe(false);
  });

  it('fails visibly when the put is refused', async () => {
    const service = new FakeAssetsService();
    service.failNext({ route: 'put', status: 410, code: 'upload-closed' });
    const upload = uploading(service);
    await upload.run();
    expect(upload.state().phase).toBe('failed');
  });
});

describe('uploadFailureMessage', () => {
  it('names the plan upload cap and owner storage cap from a 413 refusal', () => {
    expect(
      uploadFailureMessage(
        Object.assign(new AssetsHttpError(413, 'too-large', 'service'), { limit: 26_214_400 }),
      ),
    ).toBe("This board's plan takes images up to 25 MB.");
    expect(
      uploadFailureMessage(
        Object.assign(new AssetsHttpError(413, 'storage-limit', 'service'), {
          limit: 524_288_000,
          used: 524_288_000,
        }),
      ),
    ).toBe("This board's owner has used their plan's 500 MB of image storage.");
  });
  it('says why in a sentence', () => {
    const cases: [unknown, string][] = [
      [new Error('x'), 'The upload failed.'],
      [new AssetsHttpError(0, 'network', 'x'), 'The upload could not reach the server.'],
      [new AssetsHttpError(403, 'forbidden', 'x'), 'This board does not let you upload images.'],
      [new AssetsHttpError(413, 'too-large', 'x'), 'The image is larger than the server takes.'],
      [
        new AssetsHttpError(422, 'unsupported-image', 'x'),
        'The server does not take this kind of image.',
      ],
      [
        new AssetsHttpError(415, 'unsupported', 'x'),
        'The server does not take this kind of image.',
      ],
    ];
    for (const [error, message] of cases) expect(uploadFailureMessage(error)).toBe(message);
  });
});
