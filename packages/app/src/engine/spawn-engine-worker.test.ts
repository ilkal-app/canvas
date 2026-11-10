import { afterEach, describe, expect, it, vi } from 'vitest';

import { spawnEngineWorker } from './spawn-engine-worker.js';

const transport = vi.hoisted(() => ({
  wrapped: [] as unknown[],
  calls: [] as { connect: unknown[][]; post: unknown[][]; terminated: number }[],
}));
const fontEvents = vi.hoisted(() => ({
  listeners: [] as (() => void)[],
  stopped: 0,
}));
const page = vi.hoisted(() => {
  let settle: () => void = () => undefined;
  const loaded = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    fonts: { name: 'page fonts' },
    loaded,
    settle: () => {
      settle();
    },
    posted: [] as unknown[][],
  };
});

// Only the wrapping and the font hand-off are checked here; the transport is the engine's.
vi.mock('@canvas/engine', () => ({
  createWebWorkerTransport: (worker: unknown) => {
    transport.wrapped.push(worker);
    const calls = { connect: [] as unknown[][], post: [] as unknown[][], terminated: 0 };
    transport.calls.push(calls);
    return {
      connect: (...args: unknown[]) => calls.connect.push(args),
      post: (...args: unknown[]) => calls.post.push(args),
      terminate: () => {
        calls.terminated += 1;
      },
    };
  },
}));
vi.mock('../text-input/page-fonts.js', () => ({
  loadPageFonts: () => ({ fonts: page.fonts, loaded: page.loaded }),
  subscribePageFonts: (listener: () => void) => {
    fontEvents.listeners.push(listener);
    return () => {
      fontEvents.stopped += 1;
    };
  },
}));
vi.mock('../text-input/worker-font-files.js', () => ({
  postFontFiles: (...args: unknown[]) => page.posted.push(args),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('spawnEngineWorker', () => {
  it('starts engine-worker.ts as a module worker, wraps it, and posts it the page’s fonts once loaded', async () => {
    const started: { url: string; options: unknown; worker: unknown }[] = [];
    // A Worker stand-in that records how it was started.
    const workerStandIn = vi.fn(function (this: unknown, url: URL, options: unknown) {
      started.push({ url: url.href, options, worker: this });
    });
    vi.stubGlobal('Worker', workerStandIn);
    const result = spawnEngineWorker();
    expect(started).toEqual([
      {
        url: expect.stringMatching(/\/engine-worker\.ts$/) as unknown,
        options: { type: 'module' },
        worker: expect.anything() as unknown,
      },
    ]);
    expect(transport.wrapped).toEqual([started[0]?.worker]);
    expect(result).toHaveProperty('terminate');
    expect(page.posted).toEqual([]);
    page.settle();
    await page.loaded;
    await Promise.resolve();
    expect(page.posted).toEqual([[started[0]?.worker, page.fonts, expect.any(Map)]]);
  });

  it('forwards connect and post to the wrapped transport, and terminate stops the font hand-off', () => {
    vi.stubGlobal(
      'Worker',
      vi.fn(function () {
        // A Worker stand-in; the transport is faked.
      }),
    );
    const result = spawnEngineWorker();
    const calls = transport.calls.at(-1);
    const fontsChanged = fontEvents.listeners.at(-1);
    const listener = { onMessage: () => undefined, onFailure: () => undefined };
    const message = { type: 'ping' } as unknown as Parameters<typeof result.post>[0];
    const buffer = new ArrayBuffer(4);
    result.connect(listener);
    result.post(message, [buffer]);
    expect(calls?.connect).toEqual([[listener]]);
    expect(calls?.post).toEqual([[message, [buffer]]]);
    // A font change while running posts the fonts again.
    const postedBefore = page.posted.length;
    fontsChanged?.();
    expect(page.posted).toHaveLength(postedBefore + 1);
    const stoppedBefore = fontEvents.stopped;
    result.terminate();
    expect(calls?.terminated).toBe(1);
    expect(fontEvents.stopped).toBe(stoppedBefore + 1);
    // After terminate, a late font change posts nothing to the stopped worker.
    fontsChanged?.();
    expect(page.posted).toHaveLength(postedBefore + 1);
  });
});
