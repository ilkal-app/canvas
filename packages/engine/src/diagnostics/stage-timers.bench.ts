import { bench, describe } from 'vitest';

import { CAMERA_UNIFORM_BYTE_LENGTH } from '../scene/camera-uniform.js';
import type { FrameContext, FrameStage } from '../scene/frame-context.js';
import { NO_FRAME_TIMERS } from '../scene/frame-context.js';
import { Frame } from '../scene/frame.js';

import type { FrameHistory } from './frame-history.js';
import { installStageTimers } from './install-stage-timers.js';
import { percentilePair } from './percentiles.js';
import { StageTimers } from './stage-timers.js';
import { createBenchmarkSample } from './stats-export.js';

// The stage timers' own cost (measuring must not cost frames). Budget:
// under 20 µs per frame at 10 stages, timed minus untimed. The benchmark export runs at the
// overlay's 4 Hz, so its cost over a full history is reported too.
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const STAGE_COUNT = 10;

// The host's clock, as the app passes it; the engine core has no DOM or Node types.
const hostClock = (globalThis as unknown as { performance: { now(): number } }).performance;
const clock = (): number => hostClock.now();

function noOpStages(): FrameStage[] {
  return Array.from({ length: STAGE_COUNT }, (unused, index) => ({
    name: `stage${String(index)}`,
    run: () => undefined,
  }));
}

// The fields the stage timers read at the end of a frame: counters, a draw list, one pass's
// buffers, the camera uniform and a backend without timestamp queries.
function frameContext(frameIndex: number): FrameContext {
  return {
    frameIndex,
    timeMs: frameIndex * 16,
    timers: NO_FRAME_TIMERS,
    stats: {
      changedObjects: 0,
      bufferWrites: 1,
      uploadedBytes: CAMERA_UNIFORM_BYTE_LENGTH,
      drawCalls: 1,
    },
    drawList: [{ passName: 'solid-rect', ranges: [{ start: 0, count: 10_000 }] }],
    layers: [],
    passes: [{ pass: { name: 'solid-rect' }, instances: { byteLength: 655_360 } }],
    cameraUniform: { buffer: { byteLength: CAMERA_UNIFORM_BYTE_LENGTH } },
    backend: { capabilities: { hasTimestampQuery: false } },
  } as unknown as FrameContext;
}

describe(`a frame of ${String(STAGE_COUNT)} empty stages`, () => {
  const untimed = new Frame(noOpStages());
  const untimedContext = frameContext(0);
  bench('without stage timers', () => {
    untimed.run(untimedContext);
  });

  const timed = new Frame(noOpStages());
  installStageTimers(timed, new StageTimers({ clock }));
  const timedContext = frameContext(0) as { -readonly [K in keyof FrameContext]: FrameContext[K] };
  bench('with stage timers installed (budget: +20 µs)', () => {
    timedContext.frameIndex += 1;
    timed.run(timedContext);
  });
});

describe('frame statistics summary', () => {
  const timers = new StageTimers({ clock });
  const frame = new Frame(noOpStages());
  installStageTimers(frame, timers);
  for (let index = 0; index < timers.history.capacity; index += 1) frame.run(frameContext(index));
  const history: FrameHistory = timers.history;

  const shape = `${String(history.capacity)} frames × ${String(STAGE_COUNT)} stages`;
  bench(`createBenchmarkSample over ${shape}`, () => {
    createBenchmarkSample(history);
  });

  const values = Array.from({ length: history.capacity }, (unused, index) => (index * 7919) % 97);
  bench(`percentilePair over ${String(values.length)} values`, () => {
    percentilePair(values);
  });
});
