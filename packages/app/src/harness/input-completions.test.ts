import { expect, it } from 'vitest';

import type { EngineFrameReport } from '@canvas/engine';

import { transferTimingsSince } from './input-completions.js';

it('skips frames without transfer timings', () => {
  const frames = [
    { frameTimeMs: 10 },
    { frameTimeMs: 20, transferMs: { pageToWorker: 1, workerToPage: 2 } },
  ] as unknown as EngineFrameReport[];
  expect(transferTimingsSince(frames, 0)).toEqual([
    { frameTimeMs: 20, pageToWorkerMs: 1, workerToPageMs: 2 },
  ]);
});
