import { expect, it } from 'vitest';

import { FrameHistory } from './frame-history.js';
import { createBenchmarkSample } from './stats-export.js';

it('reports nearest-rank p90 for every frame counter and CPU-plus-GPU frame work', () => {
  const history = new FrameHistory(100);
  for (let index = 1; index <= 100; index += 1) {
    const frame = history.beginSample(index, index * 16);
    frame.cpuMs = index;
    frame.drawCalls = index;
    frame.passGpuMs[history.passIndexOf('scene')] = 10;
    history.commitSample();
  }
  const sample = createBenchmarkSample(history);
  expect(sample.p90.cpuMs).toBe(90);
  expect(sample.p90.drawCalls).toBe(90);
  expect(sample.frameWorkMs.p90).toBe(100);
  expect(sample.p50.cpuMs).toBeLessThanOrEqual(sample.p90.cpuMs);
  expect(sample.p90.cpuMs).toBeLessThanOrEqual(sample.p95.cpuMs);
  expect(sample.frameWorkMs.p50).toBeLessThanOrEqual(sample.frameWorkMs.p90);
  expect(sample.frameWorkMs.p90).toBeLessThanOrEqual(sample.frameWorkMs.p95);
});
