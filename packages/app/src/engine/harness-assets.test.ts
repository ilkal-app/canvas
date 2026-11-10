import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AssetLatch,
  createHarnessImageSupport,
  HARNESS_LEVEL_LATENCY_MS,
  harnessLatency,
  listenForAssetLatch,
  type HarnessAssetMessage,
  type HarnessChannel,
  type LatchChannel,
} from './harness-assets.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('harnessLatency', () => {
  it('serves a smallest level at once', async () => {
    let isDone = false;
    void harnessLatency({ kind: 'level', assetId: 'a' as never, longEdgePx: 128 }).then(() => {
      isDone = true;
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(isDone).toBe(true);
  });

  it('serves larger levels, tiles and originals after the latency', async () => {
    const done: string[] = [];
    const requests = [
      { kind: 'level', assetId: 'a' as never, longEdgePx: 512 },
      { kind: 'tile', assetId: 'a' as never, longEdgePx: 3 },
      { kind: 'original', assetId: 'a' as never, longEdgePx: undefined },
    ] as const;
    for (const request of requests) {
      void harnessLatency(request).then(() => done.push(request.kind));
    }

    await vi.advanceTimersByTimeAsync(HARNESS_LEVEL_LATENCY_MS - 1);
    expect(done).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toEqual(['level', 'tile', 'original']);
  });
});

describe('AssetLatch', () => {
  it('holds larger levels past their latency until released, and answers on its channel', async () => {
    const latch = new AssetLatch();
    const answers: string[] = [];
    const channel: LatchChannel = {
      onmessage: null,
      postMessage: (message: HarnessAssetMessage) => answers.push(message.type),
    };
    listenForAssetLatch(latch, channel);
    const send = (type: HarnessAssetMessage['type']): void => {
      channel.onmessage?.({ data: { type } } as MessageEvent<HarnessAssetMessage>);
    };
    let isServed = false;

    send('hold');
    void harnessLatency({ kind: 'level', assetId: 'a' as never, longEdgePx: 2048 }, latch).then(
      () => {
        isServed = true;
      },
    );
    await vi.advanceTimersByTimeAsync(HARNESS_LEVEL_LATENCY_MS * 4);
    expect(isServed).toBe(false);
    send('release');
    await vi.advanceTimersByTimeAsync(0);

    expect(isServed).toBe(true);
    expect(answers).toEqual(['held', 'released']);
  });
});

describe('createHarnessImageSupport', () => {
  it('opens one latch channel, answers a scenario on it, and closes it with the engine', () => {
    const answers: string[] = [];
    let opened = 0;
    let closed = 0;
    const channel: HarnessChannel = {
      onmessage: null,
      postMessage: (message: HarnessAssetMessage) => answers.push(message.type),
      close: () => {
        closed += 1;
      },
    };
    const support = createHarnessImageSupport(() => {
      opened += 1;
      return channel;
    });

    channel.onmessage?.({ data: { type: 'hold' } } as MessageEvent<HarnessAssetMessage>);
    support.close?.();

    expect([opened, closed]).toEqual([1, 1]);
    expect(answers).toEqual(['held']);
  });

  it('serves without a channel where the thread has none', () => {
    const support = createHarnessImageSupport(() => undefined);

    expect(() => support.close?.()).not.toThrow();
  });

  it('serves its assets through the latch: the smallest level at once, a larger one once released', async () => {
    const channel: HarnessChannel = {
      onmessage: null,
      postMessage: () => undefined,
      close: () => undefined,
    };
    const { assets } = createHarnessImageSupport(() => channel);
    const assetId = 'harness-image' as never;
    const { levels } = await assets.describe(assetId);
    const longEdges = levels.map(({ longEdgePx }) => longEdgePx);
    const larger = longEdges.find((edge) => edge > 128);
    expect(longEdges).toContain(128);
    expect(larger).toBeDefined();
    channel.onmessage?.({ data: { type: 'hold' } } as MessageEvent<HarnessAssetMessage>);
    const served: number[] = [];
    void assets.fetchLevel(assetId, larger ?? 0).then(() => served.push(larger ?? 0));
    void assets.fetchLevel(assetId, 128).then(() => served.push(128));

    await vi.advanceTimersByTimeAsync(HARNESS_LEVEL_LATENCY_MS * 4);
    expect(served).toEqual([128]);
    channel.onmessage?.({ data: { type: 'release' } } as MessageEvent<HarnessAssetMessage>);
    await vi.advanceTimersByTimeAsync(0);

    expect(served).toEqual([128, larger]);
  });
});
