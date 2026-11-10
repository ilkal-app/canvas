import { expect, it, vi } from 'vitest';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import type { EngineFrameReport } from './engine-host.js';
import { EngineRuntime } from './engine-runtime.js';
import { isHostToWorkerMessage } from './host-protocol.js';
import { MainThreadEngineHost } from './main-thread-engine-host.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

it.each(['main', 'worker'] as const)(
  'acknowledges only drawn frames and coalesces ordered %s markers',
  async (kind) => {
    const platform = new FakeHostPlatform();
    const worker = new InMemoryEngineWorker();
    const canvas = new FakeCanvas(4, 2);
    const host =
      kind === 'main'
        ? await MainThreadEngineHost.create(canvas, platform)
        : await WorkerEngineHost.create(worker, canvas, 0);
    const frame = async (time: number) => {
      if (kind === 'main') platform.runFrame(time);
      else await worker.runFrame(time);
      await settle();
    };
    const completed: number[] = [];
    const first = host.requestFrameAcknowledgement().then((index) => {
      completed.push(index);
      return index;
    });
    await frame(16);
    expect(completed).toEqual([]);
    host.setCamera(CAMERA);
    const second = host.requestFrameAcknowledgement();
    await frame(32);
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    const pending = host.requestFrameAcknowledgement();
    const rejected = expect(pending).rejects.toThrow('destroyed');
    host.destroy();
    await rejected;
    await expect(host.requestFrameAcknowledgement()).rejects.toThrow('destroyed');
  },
);

it('rejects failed worker markers without reusing ids or accepting unrelated reports', async () => {
  const worker = new InMemoryEngineWorker();
  const host = await WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 0);
  host.onFault(() => undefined);
  host.setCamera(CAMERA);
  const old = host.requestFrameAcknowledgement();
  const rejected = expect(old).rejects.toThrow('failed');
  await settle();
  worker.deliver({ type: 'engine-failure', failure: { name: 'Error', message: 'failed' } });
  await rejected;
  let isCompleted = false;
  const next = host.requestFrameAcknowledgement().then((index) => {
    isCompleted = true;
    return index;
  });
  worker.deliver({
    type: 'engine-frame',
    report: { frameIndex: 7, frameTimeMs: 0, acknowledgementId: 1 },
  });
  worker.deliver({ type: 'engine-frame', report: { frameIndex: 8, frameTimeMs: 0 } });
  await settle();
  expect(isCompleted).toBe(false);
  await worker.runFrame(16);
  expect(await next).toBe(0);
  host.destroy();
});

it('snapshots markers before rendering and acknowledges none on a failed frame', () => {
  const canvas = new FakeCanvas(4, 2);
  const platform = new FakeHostPlatform();
  const backend = new ReadableFakeGpuBackend(canvas);
  const reports: EngineFrameReport[] = [];
  const faults: Error[] = [];
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    {},
    {
      onFrame: (report) => {
        reports.push(report);
      },
      onFault: (error) => {
        faults.push(error);
      },
    },
  );
  runtime.setCamera(CAMERA);
  let shouldReenter = true;
  runtime.renderer.frame.wrapStage('collectChanges', (inner) => ({
    name: inner.name,
    run(context) {
      inner.run(context);
      if (shouldReenter) {
        shouldReenter = false;
        runtime.markFrameAcknowledgement(2);
      }
    },
  }));
  runtime.markFrameAcknowledgement(1);
  platform.runFrame(16);
  expect(reports.at(-1)?.acknowledgementId).toBe(1);
  platform.runFrame(32);
  expect(reports.at(-1)?.acknowledgementId).toBe(2);
  backend.submitFailure = new Error('submit failed');
  runtime.markFrameAcknowledgement(3);
  platform.runFrame(48);
  expect(reports).toHaveLength(2);
  expect(faults).toHaveLength(1);
  runtime.destroy();
});

it.each([0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid marker id %s',
  (id) => {
    expect(
      isHostToWorkerMessage({
        type: 'engine-commands',
        commands: [{ type: 'acknowledge-frame', id }],
      }),
    ).toBe(false);
  },
);
it('accepts a positive safe marker id', () => {
  expect(
    isHostToWorkerMessage({
      type: 'engine-commands',
      commands: [{ type: 'acknowledge-frame', id: 1 }],
    }),
  ).toBe(true);
});

it('ignores malformed or future worker watermarks and frame indices', async () => {
  const worker = new InMemoryEngineWorker();
  const host = await WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 0);
  host.setCamera(CAMERA);
  let isCompleted = false;
  const pending = host.requestFrameAcknowledgement().then((index) => {
    isCompleted = true;
    return index;
  });
  await settle();
  for (const acknowledgementId of [0, -1, 1.5, Infinity, NaN, 2, '1']) {
    worker.deliver({
      type: 'engine-frame',
      report: { frameIndex: 0, frameTimeMs: 0, camera: CAMERA, acknowledgementId },
    });
  }
  for (const frameIndex of [-1, 0.5, Infinity, NaN]) {
    worker.deliver({
      type: 'engine-frame',
      report: { frameIndex, frameTimeMs: 0, camera: CAMERA, acknowledgementId: 1 },
    });
  }
  await settle();
  expect(isCompleted).toBe(false);
  await worker.runFrame(16);
  expect(await pending).toBe(0);
  host.destroy();
});

it('rejects main-thread failed frames and keeps its marker counter monotonic', async () => {
  const platform = new FakeHostPlatform();
  const host = await MainThreadEngineHost.create(new FakeCanvas(4, 2), platform);
  const faults: Error[] = [];
  const reports: EngineFrameReport[] = [];
  host.onFault((error) => {
    faults.push(error);
  });
  host.onFrame((report) => {
    reports.push(report);
  });
  host.setCamera(CAMERA);
  const failed = host.requestFrameAcknowledgement();
  const rejected = expect(failed).rejects.toThrow('submit failed');
  const backend = platform.backends[0];
  if (!backend) throw new Error('Missing backend');
  backend.submitFailure = new Error('submit failed');
  platform.runFrame(16);
  await rejected;
  expect(faults).toHaveLength(1);
  expect(reports).toEqual([]);
  const next = host.requestFrameAcknowledgement();
  platform.runFrame(32);
  expect(await next).toBe(0);
  expect(reports[0]?.acknowledgementId).toBe(2);
  host.destroy();
});

it('rejects pending worker acknowledgements when command posting throws', async () => {
  const worker = new InMemoryEngineWorker();
  const host = await WorkerEngineHost.create(worker, new FakeCanvas(4, 2), 0);
  host.onFault(() => undefined);
  const posting = vi.spyOn(worker, 'post').mockImplementation(() => {
    throw new Error('post failed');
  });
  const first = expect(host.requestFrameAcknowledgement()).rejects.toThrow('post failed');
  const second = expect(host.requestFrameAcknowledgement()).rejects.toThrow('post failed');
  await settle();
  await Promise.all([first, second]);
  posting.mockRestore();
  host.setCamera(CAMERA);
  const recovered = host.requestFrameAcknowledgement();
  await worker.runFrame(16);
  expect(await recovered).toBe(0);
  host.destroy();
});
