import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkFontBytes as checkFontBytesExport,
  LOCAL_FONT_CHECK_TIMEOUT_MS,
  LocalFontChecker,
} from './local-font-check.js';

// Acceptance map: parser, cmap and HarfBuzz accept the three static corpus
// formats and report damaged files without changing their input. The checker transfers a copy,
// serializes and routes worker jobs, recovers after timeout/error/messageerror, and falls back on
// the page without a Worker.

const CORPUS = '../../../text/src/__fixtures__/format-corpus/';

// The acceptance's own contract for the module, written test-first. The module is imported
// statically: a runtime import in a 10 s beforeAll timed out on a loaded queue shard.
type FontCheck =
  { readonly isReadable: true } | { readonly isReadable: false; readonly reason: string };
interface FontCheckWorker {
  onmessage:
    ((event: MessageEvent<{ id: number; isReadable: boolean; reason?: string }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: { id: number; bytes: ArrayBuffer }, transfer: Transferable[]): void;
  terminate(): void;
}
interface FontCheckModule {
  readonly checkFontBytes: (bytes: ArrayBuffer) => Promise<FontCheck>;
  readonly fontCheckTimeoutMs: number;
  readonly checkerClass: new (options?: {
    spawn?: () => FontCheckWorker | undefined;
    timeoutMs?: number;
    checkOnPage?: (bytes: ArrayBuffer) => Promise<FontCheck>;
  }) => { check(bytes: ArrayBuffer): Promise<FontCheck> };
}

const checkFontBytes: FontCheckModule['checkFontBytes'] = checkFontBytesExport;
const fontCheckTimeoutMs: FontCheckModule['fontCheckTimeoutMs'] = LOCAL_FONT_CHECK_TIMEOUT_MS;
const checkerClass: FontCheckModule['checkerClass'] = LocalFontChecker;

function corpus(filename: string): ArrayBuffer {
  return Uint8Array.from(readFileSync(new URL(`${CORPUS}${filename}`, import.meta.url))).buffer;
}

type CheckRequest = Parameters<FontCheckWorker['postMessage']>[0];
type CheckTransfer = Parameters<FontCheckWorker['postMessage']>[1];

class ManualWorker implements FontCheckWorker {
  onmessage: FontCheckWorker['onmessage'] = null;
  onerror: FontCheckWorker['onerror'] = null;
  onmessageerror: FontCheckWorker['onmessageerror'] = null;
  readonly requests: { message: CheckRequest; transfer: CheckTransfer }[] = [];
  isTerminated = false;

  postMessage(message: CheckRequest, transfer: CheckTransfer): void {
    this.requests.push({ message, transfer });
  }

  terminate(): void {
    this.isTerminated = true;
  }

  answer(id: number, result: FontCheck): void {
    this.onmessage?.(new MessageEvent('message', { data: { id, ...result } }));
  }
}

function requestAt(worker: ManualWorker, index: number): CheckRequest {
  const request = worker.requests[index]?.message;
  if (request === undefined) throw new Error(`Missing worker request ${String(index)}`);
  return request;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('checkFontBytes', () => {
  it.each(['ttf', 'cff.otf', 'cff2.otf'])(
    'accepts static corpus %s after parsing its character map and shaping a sample',
    async (extension) => {
      const bytes = corpus(`corpus-sans-regular.${extension}`);
      const original = bytes.slice(0);
      expect(await checkFontBytes(bytes)).toEqual({ isReadable: true });
      expect(bytes.byteLength).toBe(original.byteLength);
      expect(new Uint8Array(bytes)).toEqual(new Uint8Array(original));
    },
  );

  it.each([
    ['garbage', () => Uint8Array.from([1, 2, 3, 4]).buffer],
    ['truncated TTF', () => corpus('corpus-sans-regular.ttf').slice(0, 24)],
    [
      'TTF with an oversized table',
      () => {
        const bytes = corpus('corpus-sans-regular.ttf');
        const view = new DataView(bytes);
        const count = view.getUint16(4);
        for (let index = 0; index < count; index += 1) {
          const offset = 12 + index * 16;
          const tag = String.fromCharCode(...new Uint8Array(bytes, offset, 4));
          if (tag === 'hmtx') {
            view.setUint32(offset + 12, 0xffff_ffff);
            return bytes;
          }
        }
        throw new Error('Corpus TTF has no hmtx table');
      },
    ],
  ])(
    'settles %s as unreadable with a reason and preserves the input',
    async (unused, makeBytes) => {
      const bytes = makeBytes();
      const original = bytes.slice(0);
      const result = await checkFontBytes(bytes);
      expect(result.isReadable).toBe(false);
      if (!result.isReadable) expect(result.reason.length).toBeGreaterThan(0);
      expect(bytes.byteLength).toBe(original.byteLength);
      expect(new Uint8Array(bytes)).toEqual(new Uint8Array(original));
    },
  );
});

describe('LocalFontChecker', () => {
  it('uses one worker, sends one request at a time, and routes answers by id in queue order', async () => {
    const worker = new ManualWorker();
    const spawn = vi.fn(() => worker);
    const checker = new checkerClass({ spawn });
    expect(spawn).not.toHaveBeenCalled();
    const results = [1, 2, 3].map((value) => checker.check(Uint8Array.from([value]).buffer));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(worker.requests).toHaveLength(1);

    const first = requestAt(worker, 0);
    worker.answer(first.id + 100, { isReadable: true });
    expect(worker.requests).toHaveLength(1);
    worker.answer(first.id, { isReadable: true });
    expect(await results[0]).toEqual({ isReadable: true });
    expect(worker.requests).toHaveLength(2);

    const second = requestAt(worker, 1);
    expect(second.id).not.toBe(first.id);
    worker.answer(second.id, { isReadable: false, reason: 'bad face' });
    expect(await results[1]).toEqual({ isReadable: false, reason: 'bad face' });
    expect(worker.requests).toHaveLength(3);

    const third = requestAt(worker, 2);
    expect(third.id).not.toBe(second.id);
    expect([
      ...new Uint8Array(first.bytes),
      ...new Uint8Array(second.bytes),
      ...new Uint8Array(third.bytes),
    ]).toEqual([1, 2, 3]);
    worker.answer(third.id, { isReadable: true });
    expect(await results[2]).toEqual({ isReadable: true });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('transfers a copy and leaves the caller buffer attached and unchanged', async () => {
    const worker = new ManualWorker();
    const checker = new checkerClass({ spawn: () => worker });
    const bytes = Uint8Array.from([10, 20, 30]).buffer;
    const result = checker.check(bytes);
    const { message, transfer } = worker.requests[0] ?? {};
    if (message === undefined || transfer === undefined) throw new Error('Missing request');
    expect(message.bytes).not.toBe(bytes);
    expect(transfer).toContain(message.bytes);
    structuredClone(message, { transfer });
    expect(message.bytes.byteLength).toBe(0);
    expect([...new Uint8Array(bytes)]).toEqual([10, 20, 30]);
    worker.answer(message.id, { isReadable: true });
    expect(await result).toEqual({ isReadable: true });
  });

  it('times out a silent worker, terminates it, and spawns a fresh one for the next check', async () => {
    vi.useFakeTimers();
    const workers: ManualWorker[] = [];
    const checker = new checkerClass({
      spawn: () => {
        const worker = new ManualWorker();
        workers.push(worker);
        return worker;
      },
      timeoutMs: fontCheckTimeoutMs,
    });
    const stalled = checker.check(corpus('corpus-sans-regular.ttf'));
    const first = workers[0];
    if (first === undefined) throw new Error('Missing first worker');
    await vi.advanceTimersByTimeAsync(fontCheckTimeoutMs);
    const outcome = await stalled;
    expect(outcome.isReadable).toBe(false);
    if (!outcome.isReadable) expect(outcome.reason).toContain('timed out');
    expect(first.isTerminated).toBe(true);

    const again = checker.check(corpus('corpus-sans-bold.ttf'));
    const fresh = workers[1];
    if (fresh === undefined) throw new Error('Missing fresh worker');
    fresh.answer(requestAt(fresh, 0).id, { isReadable: true });
    expect(await again).toEqual({ isReadable: true });
    expect(workers).toHaveLength(2);
  });

  it.each(['error', 'messageerror'])(
    'settles %s as unreadable, terminates the failed worker and respawns',
    async (kind) => {
      const workers: ManualWorker[] = [];
      const checker = new checkerClass({
        spawn: () => {
          const worker = new ManualWorker();
          workers.push(worker);
          return worker;
        },
      });
      const failed = checker.check(Uint8Array.from([1]).buffer);
      const first = workers[0];
      if (first === undefined) throw new Error('Missing first worker');
      if (kind === 'error') first.onerror?.(new Event('error') as ErrorEvent);
      else first.onmessageerror?.(new MessageEvent('messageerror'));
      const outcome = await failed;
      expect(outcome.isReadable).toBe(false);
      if (!outcome.isReadable) expect(outcome.reason.length).toBeGreaterThan(0);
      expect(first.isTerminated).toBe(true);

      const again = checker.check(Uint8Array.from([2]).buffer);
      const fresh = workers[1];
      if (fresh === undefined) throw new Error('Missing fresh worker');
      fresh.answer(requestAt(fresh, 0).id, { isReadable: true });
      expect(await again).toEqual({ isReadable: true });
      expect(workers).toHaveLength(2);
    },
  );

  it('uses the injected page check when no worker exists, without detaching the input', async () => {
    const checkOnPage = vi.fn((bytes: ArrayBuffer) =>
      Promise.resolve({ isReadable: bytes.byteLength > 0 } as FontCheck),
    );
    const checker = new checkerClass({ spawn: () => undefined, checkOnPage });
    const bytes = Uint8Array.from([7]).buffer;
    expect(await checker.check(bytes)).toEqual({ isReadable: true });
    expect(checkOnPage).toHaveBeenCalledWith(bytes);
    expect(bytes.byteLength).toBe(1);
  });

  it('settles a rejected page fallback as unreadable instead of rejecting', async () => {
    const checker = new checkerClass({
      spawn: () => undefined,
      checkOnPage: () => Promise.reject(new Error('HarfBuzz failed')),
    });
    const result = await checker.check(Uint8Array.from([7]).buffer);
    expect(result.isReadable).toBe(false);
    if (!result.isReadable) expect(result.reason).toContain('HarfBuzz failed');
  });

  it('starts a module worker beside the checker by default', async () => {
    const started: { url: URL; options: WorkerOptions | undefined; worker: ManualWorker }[] = [];
    vi.stubGlobal(
      'Worker',
      class extends ManualWorker {
        constructor(url: URL, options?: WorkerOptions) {
          super();
          started.push({ url, options, worker: this });
        }
      },
    );
    const checker = new checkerClass();
    const result = checker.check(Uint8Array.from([1]).buffer);
    const start = started[0];
    if (start === undefined) throw new Error('Worker did not start');
    expect(start.url.pathname.endsWith('local-font-check-worker.ts')).toBe(true);
    expect(start.options).toEqual({ type: 'module' });
    start.worker.answer(requestAt(start.worker, 0).id, { isReadable: true });
    expect(await result).toEqual({ isReadable: true });
  });
});

it('worker script answers each request with its id and the real font check result', async () => {
  const answers: { id: number; isReadable: boolean; reason?: string }[] = [];
  const scope: {
    onmessage?: (event: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => void;
    postMessage: (answer: { id: number; isReadable: boolean; reason?: string }) => void;
  } = {
    postMessage: (answer) => {
      answers.push(answer);
    },
  };
  vi.stubGlobal('self', scope);
  await vi.importActual('./local-font-check-worker.js');
  scope.onmessage?.(
    new MessageEvent('message', {
      data: { id: 41, bytes: corpus('corpus-sans-regular.ttf') },
    }),
  );
  scope.onmessage?.(
    new MessageEvent('message', {
      data: { id: 42, bytes: Uint8Array.from([1, 2, 3]).buffer },
    }),
  );
  await vi.waitFor(() => {
    expect(answers).toHaveLength(2);
  });
  expect(answers.find(({ id }) => id === 41)).toEqual({ id: 41, isReadable: true });
  const unreadable = answers.find(({ id }) => id === 42);
  expect(unreadable?.isReadable).toBe(false);
  expect(unreadable?.reason?.length).toBeGreaterThan(0);
});
