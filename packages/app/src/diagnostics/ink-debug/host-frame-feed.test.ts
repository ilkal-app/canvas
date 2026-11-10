import { describe, expect, it, vi } from 'vitest';

import type { EngineFrameReport } from '@canvas/engine';

import { HostFrameFeed } from './host-frame-feed.js';

const HOST = { kind: 'worker', capabilities: { backendName: 'webgpu' } } as const;

describe('HostFrameFeed', () => {
  it('hands each report on with its host while someone listens, and stops after', () => {
    const feed = new HostFrameFeed();
    const listener = vi.fn();
    const report = { frameIndex: 1 } as EngineFrameReport;
    feed.follow(report, HOST as never, 5);
    const stop = feed.subscribe(listener);
    feed.follow(report, HOST as never, 10);
    stop();
    feed.follow(report, HOST as never, 15);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      report,
      hostKind: 'worker',
      backendName: 'webgpu',
      receivedMs: 10,
    });
  });
});
