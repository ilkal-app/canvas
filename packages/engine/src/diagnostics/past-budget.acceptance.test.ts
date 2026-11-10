import { describe, expect, it } from 'vitest';

import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { FrameContext } from '../scene/frame-context.js';

import { FRAME_COUNTER_NAMES } from './frame-sample.js';
import { StageTimers } from './stage-timers.js';
import { createBenchmarkSample } from './stats-export.js';

function clock() {
  let now = 0;
  return { read: () => now, advance: (ms: number) => (now += ms) };
}

function context(frameIndex: number): FrameContext {
  return {
    frameIndex,
    timeMs: frameIndex * 16,
    backend: { capabilities: { hasTimestampQuery: false } } as GpuBackend,
    stats: {},
    drawList: [],
    layers: [],
    passes: [],
    cameraUniform: { buffer: { byteLength: 32 } },
  } as unknown as FrameContext;
}

describe('frame time past budget', () => {
  it('records the nonnegative excess per frame and summarises it', () => {
    const fake = clock();
    const timers = new StageTimers({ clock: fake.read, frameBudgetMs: 8 });
    for (const [index, duration] of [5, 8, 11].entries()) {
      const frame = context(index);
      timers.beginFrame(frame);
      timers.stageStarted('draw');
      fake.advance(duration);
      timers.stageEnded('draw');
      timers.endFrame(frame);
    }
    expect(FRAME_COUNTER_NAMES).toContain('pastBudgetMs');
    expect(
      [0, 1, 2].map(
        (index) => (timers.history.at(index) as unknown as { pastBudgetMs: number }).pastBudgetMs,
      ),
    ).toEqual([0, 0, 3]);
    const sample = createBenchmarkSample(timers.history);
    expect(sample.p50.pastBudgetMs).toBe(0);
    expect(sample.p95.pastBudgetMs).toBe(3);
    expect(sample.max.pastBudgetMs).toBe(3);
  });

  it('uses 8 ms as the default frame budget', () => {
    const fake = clock();
    const timers = new StageTimers({ clock: fake.read });
    const frame = context(0);
    timers.beginFrame(frame);
    timers.stageStarted('draw');
    fake.advance(9);
    timers.stageEnded('draw');
    timers.endFrame(frame);
    expect(timers.history.newest?.pastBudgetMs).toBe(1);
  });
});
