import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { pngBytes } from './__fixtures__/image-headers.js';
import {
  ImagePreparer,
  MAX_PREPARING,
  prepareImageFile,
  type PrepareAnswer,
  type PrepareOutcome,
  type PrepareRequest,
  type PrepareWorker,
} from './prepare-image.js';

const PNG = pngBytes(40, 30);
const HASH = createHash('sha256').update(PNG).digest('hex');

/**
 * A PNG file whose header claims a size.
 *
 * @param width - The width it claims, px.
 * @param height - The height it claims, px.
 * @returns The file.
 */
function pngFile(width = 40, height = 30): Blob {
  return new Blob([pngBytes(width, height)], { type: 'image/png' });
}

/**
 * A worker the test answers by hand, recording what it was asked.
 */
class ManualWorker implements PrepareWorker {
  onmessage: ((event: MessageEvent<PrepareAnswer>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly requests: PrepareRequest[] = [];
  isTerminated = false;

  postMessage(request: PrepareRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.isTerminated = true;
  }

  /**
   * Answers a request by running the real preparation.
   *
   * @param request - The request.
   */
  async answer(request: PrepareRequest): Promise<void> {
    const outcome = await prepareImageFile(request.file);
    this.onmessage?.({ data: { id: request.id, outcome } } as MessageEvent<PrepareAnswer>);
  }
}

describe('prepareImageFile', () => {
  it('reads the size from the header and hashes the bytes with SHA-256', async () => {
    expect(await prepareImageFile(pngFile())).toEqual({
      status: 'prepared',
      image: {
        assetId: HASH,
        naturalSize: { width: 40, height: 30 },
        mimeType: 'image/png',
        byteLength: PNG.length,
      },
    });
  });

  it('refuses a header claiming 100,000 × 100,000 before reading or decoding the file', async () => {
    const file = pngFile(100_000, 100_000);
    const whole = vi.spyOn(file, 'arrayBuffer');
    const digest = vi.spyOn(crypto.subtle, 'digest');
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    try {
      expect(await prepareImageFile(file)).toEqual({
        status: 'too-large',
        naturalSize: { width: 100_000, height: 100_000 },
      });
      expect(whole).not.toHaveBeenCalled();
      expect(digest).not.toHaveBeenCalled();
      expect(decode).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('calls a file unreadable when its header is not an image, or it cannot be read', async () => {
    expect(await prepareImageFile(new Blob(['not an image']))).toEqual({ status: 'unreadable' });
    const broken = pngFile();
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('gone'));
    expect(await prepareImageFile(broken)).toEqual({ status: 'unreadable' });
    const reader = () => Promise.reject(new Error('x'));
    expect(await prepareImageFile(pngFile(), reader)).toEqual({ status: 'unreadable' });
  });
});

describe('ImagePreparer', () => {
  it(`prepares at most ${String(MAX_PREPARING)} files at once in its worker, the rest queued`, async () => {
    const worker = new ManualWorker();
    let spawned = 0;
    const preparer = new ImagePreparer(() => {
      spawned += 1;
      return worker;
    });
    const files = Array.from({ length: 5 }, (unused, index) => pngFile(10 + index, 10));
    const outcomes = files.map((file) => preparer.prepare(file));
    expect(worker.requests).toHaveLength(MAX_PREPARING);
    for (let index = 0; index < files.length; index += 1) {
      const request = worker.requests[index];
      if (request === undefined) throw new Error('A request was expected.');
      await worker.answer(request);
      // One settled, one more started: never more than two in the worker.
      const settled = index + 1;
      expect(worker.requests.length - settled).toBeLessThanOrEqual(MAX_PREPARING);
    }
    const sizes = (await Promise.all(outcomes)).map((outcome) =>
      outcome.status === 'prepared' ? outcome.image.naturalSize.width : undefined,
    );
    expect(sizes).toEqual([10, 11, 12, 13, 14]);
    expect(spawned).toBe(1);
  });

  it('fails every waiting file when the worker dies mid-batch, and starts a fresh one after', async () => {
    const workers: ManualWorker[] = [];
    const preparer = new ImagePreparer(() => {
      const worker = new ManualWorker();
      workers.push(worker);
      return worker;
    });
    const outcomes = [1, 2, 3, 4].map((index) => preparer.prepare(pngFile(index, 1)));
    const [dying] = workers;
    const firstRequest = dying?.requests[0];
    if (dying === undefined || firstRequest === undefined) throw new Error('A worker started.');
    await dying.answer(firstRequest);
    dying.onerror?.(new Event('error') as ErrorEvent);
    const statuses = (await Promise.all(outcomes)).map(({ status }) => status);
    expect(statuses).toEqual(['prepared', 'reader-failed', 'reader-failed', 'reader-failed']);
    expect(dying.isTerminated).toBe(true);
    // The next drop starts a fresh worker.
    const again = preparer.prepare(pngFile());
    const fresh = workers[1];
    const request = fresh?.requests[0];
    if (fresh === undefined || request === undefined) throw new Error('A fresh worker started.');
    await fresh.answer(request);
    expect((await again).status).toBe('prepared');
  });

  it('fails the waiting files when an answer cannot be read', async () => {
    const worker = new ManualWorker();
    const preparer = new ImagePreparer(() => worker);
    const waiting = preparer.prepare(pngFile());
    worker.onmessageerror?.(new MessageEvent('messageerror'));
    expect(await waiting).toEqual({ status: 'reader-failed' } satisfies PrepareOutcome);
  });

  it('prepares on the page where no worker starts, and cancels waiting files on destroy', async () => {
    const onPage = new ImagePreparer(() => undefined);
    const outcome = await onPage.prepare(pngFile());
    expect(outcome.status === 'prepared' ? outcome.image.assetId : undefined).toBe(HASH);
    const sized = new ImagePreparer(
      () => undefined,
      () => Promise.resolve({ width: 7, height: 5 }),
    );
    const read = await sized.prepare(pngFile());
    expect(read.status === 'prepared' ? read.image.naturalSize : undefined).toEqual({
      width: 7,
      height: 5,
    });
    const stuck = new ImagePreparer(() => new ManualWorker());
    const waiting = stuck.prepare(pngFile());
    stuck.destroy();
    expect(await waiting).toEqual({ status: 'cancelled' });
  });

  it('starts a module worker by default', () => {
    const started: [URL, WorkerOptions | undefined][] = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        onerror = null;
        onmessageerror = null;
        constructor(url: URL, options?: WorkerOptions) {
          started.push([url, options]);
        }
        postMessage(): void {
          // The test never answers.
        }
        terminate(): void {
          // Nothing to stop.
        }
      },
    );
    try {
      const preparer = new ImagePreparer();
      void preparer.prepare(pngFile());
      preparer.destroy();
      expect(
        started.map(([url, options]) => [
          url.pathname.endsWith('prepare-image-worker.ts'),
          options,
        ]),
      ).toEqual([[true, { type: 'module' }]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('runs in the prepare worker, answering each request by its id', async () => {
    const answers: PrepareAnswer[] = [];
    const scope: { onmessage?: (event: MessageEvent<PrepareRequest>) => void } & {
      postMessage: (answer: PrepareAnswer) => void;
    } = { postMessage: (answer) => answers.push(answer) };
    vi.stubGlobal('self', scope);
    try {
      await import('./prepare-image-worker.js');
      scope.onmessage?.({ data: { id: 1, file: pngFile() } } as MessageEvent<PrepareRequest>);
      scope.onmessage?.({ data: { id: 2, file: new Blob([]) } } as MessageEvent<PrepareRequest>);
      await vi.waitFor(() => {
        expect(answers).toHaveLength(2);
      });
      const first = answers.find(({ id }) => id === 1)?.outcome;
      expect(first?.status === 'prepared' ? first.image.assetId : undefined).toBe(HASH);
      expect(answers.find(({ id }) => id === 2)?.outcome).toEqual({ status: 'unreadable' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
