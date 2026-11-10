import { expect, it } from 'vitest';

import { FrameHistory } from './frame-history.js';
import { createBenchmarkSample } from './stats-export.js';

it('exports nearest-rank p90 frame counters and CPU plus GPU work over the covered frames', () => {
  const history = new FrameHistory();
  for (let index = 0; index < 20; index += 1) {
    const frame = history.beginSample(index, index * 16);
    frame.cpuMs = index + 1;
    frame.drawCalls = index + 1;
    frame.passGpuMs[history.passIndexOf('scene')] = index + 1;
    history.commitSample();
  }

  const sample = createBenchmarkSample(history);
  expect(sample).toHaveProperty('p90.cpuMs', 18);
  expect(sample).toHaveProperty('p90.drawCalls', 18);
  expect(sample.p95.cpuMs).toBe(19);
  expect(sample.frameWorkMs).toHaveProperty('p90', 36);
  expect(sample.frameWorkMs.p95).toBe(38);
});
