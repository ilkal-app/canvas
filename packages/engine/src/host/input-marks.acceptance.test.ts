import { expect, it, vi } from 'vitest';

import type { InputMark } from '../index.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { EngineRuntime } from './engine-runtime.js';
import { MainThreadEngineHost } from './main-thread-engine-host.js';
import { WorkerEngineHost } from './worker-engine-host.js';

interface InputsCompleted {
  frameIndex: number;
  frameTimeMs: number;
  marks: readonly InputMark[];
  hasPendingWork: boolean;
  completedMs: number;
}

const mark: InputMark = { kind: 'drag-end', id: 1, timestampMs: 10, markedMs: 12 };
const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

function runtimeFixture() {
  const platform = new FakeHostPlatform();
  const canvas = new FakeCanvas();
  const backend = new ReadableFakeGpuBackend(canvas) as ReadableFakeGpuBackend & {
    whenSubmittedWorkDone?: () => Promise<void>;
  };
  const completions: InputsCompleted[] = [];
  const faults: Error[] = [];
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    {},
    {
      onFrame: () => undefined,
      onFault: (error) => faults.push(error),
      onInputsCompleted: (event: InputsCompleted) => completions.push(event),
    },
  );
  runtime.setCamera(camera);
  return { platform, backend, runtime, completions, faults };
}

it('waits for GPU submission only on marked frames and reports completion on the engine clock', async () => {
  const f = runtimeFixture();
  let finish: (() => void) | undefined;
  const whenDone = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  f.backend.whenSubmittedWorkDone = whenDone;
  f.runtime.requestFrame();
  f.platform.runFrame(16);
  expect(whenDone).not.toHaveBeenCalled();
  f.runtime.markInput(mark);
  expect(f.platform.pendingFrames).toBe(1);
  f.platform.runFrame(32);
  expect(whenDone).toHaveBeenCalledTimes(1);
  expect(f.completions).toEqual([]);
  f.platform.clockMs = 43;
  finish?.();
  await Promise.resolve();
  expect(f.completions).toEqual([
    { frameIndex: 1, frameTimeMs: 32, marks: [mark], hasPendingWork: false, completedMs: 43 },
  ]);
});

it('requeues marks after a failed frame and emits them on the next successful frame', async () => {
  const f = runtimeFixture();
  f.backend.submitFailure = new Error('submit failed');
  f.runtime.markInput(mark);
  f.platform.runFrame(16);
  expect(f.faults.map((error) => error.message)).toEqual(['submit failed']);
  expect(f.completions).toEqual([]);
  f.runtime.requestFrame();
  f.platform.clockMs = 35;
  f.platform.runFrame(32);
  await Promise.resolve();
  expect(f.completions[0]).toMatchObject({ frameTimeMs: 32, marks: [mark], completedMs: 35 });
});

it('completes at frame end without a backend completion hook', async () => {
  const f = runtimeFixture();
  f.platform.clockMs = 25;
  f.runtime.markInput(mark);
  f.platform.runFrame(16);
  await Promise.resolve();
  expect(f.completions[0]).toMatchObject({ marks: [mark], completedMs: 25 });
});

it('drops marks after submission rejection and keeps rendering later frames', async () => {
  const f = runtimeFixture();
  f.backend.whenSubmittedWorkDone = () => Promise.reject(new Error('device lost'));
  f.runtime.markInput(mark);
  f.platform.runFrame(16);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.completions).toEqual([]);
  expect(f.runtime.droppedInputMarks).toBe(1);
  f.runtime.requestFrame();
  f.platform.runFrame(32);
  expect(f.platform.pendingFrames).toBe(0);
});

it('main-thread host emits page-clock completions and supports unsubscribe', async () => {
  const platform = new FakeHostPlatform();
  const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
  const completions: InputsCompleted[] = [];
  const stop = host.onInputsCompleted((event: InputsCompleted) => completions.push(event));
  host.setCamera(camera);
  host.markInput(mark);
  platform.clockMs = 30;
  platform.runFrame(16);
  await Promise.resolve();
  expect(completions[0]).toMatchObject({ frameTimeMs: 16, completedMs: 30, marks: [mark] });
  stop();
  host.markInput({ ...mark, id: 2 });
  platform.runFrame(32);
  await Promise.resolve();
  expect(completions).toHaveLength(1);
  host.destroy();
});

it('worker host batches a mark after preceding commands and converts completion clocks', async () => {
  const worker = new InMemoryEngineWorker(1_000_500);
  const created = WorkerEngineHost.create(worker, new FakeCanvas(), 1_000_000);
  await settle();
  const host = await created;
  const completions: InputsCompleted[] = [];
  host.onInputsCompleted((event: InputsCompleted) => completions.push(event));
  host.setCamera(camera);
  host.setGridVisible(true);
  host.markInput(mark);
  await worker.runFrame(16);
  expect(worker.received[1]).toMatchObject({
    type: 'engine-commands',
    commands: [
      { type: 'camera', camera },
      { type: 'grid', isVisible: true },
      { type: 'mark-input', mark },
    ],
  });
  expect(completions[0]).toMatchObject({ frameTimeMs: 516, marks: [mark] });
  expect(completions[0]?.completedMs).toBeGreaterThanOrEqual(500);
  host.destroy();
});
