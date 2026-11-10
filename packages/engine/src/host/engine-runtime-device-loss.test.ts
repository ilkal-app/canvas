import { describe, expect, it, vi } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { imageObject } from '../images/__fixtures__/image-objects.js';
import { flushMicrotasks } from '../images/__fixtures__/manual-job-runner.js';
import { createFixtureAssetSource } from '../images/fixture-asset-source.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { createDecodeJobHandler } from '../workers/decode-job.js';
import type { JobHandler } from '../workers/job-handlers.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import type { EngineFrameReport } from './engine-host.js';
import { EngineRuntime } from './engine-runtime.js';
import { serializeChangeSet } from './serializable-change-set.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

function boardChange(): ReturnType<typeof serializeChangeSet> {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b', { x: 20 }));
  return serializeChangeSet(document.takeChanges());
}

describe('EngineRuntime after a lost device', () => {
  async function flush(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  }

  function setUpRecoverable() {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const reports: EngineFrameReport[] = [];
    const faults: Error[] = [];
    const first = new ReadableFakeGpuBackend(canvas);
    const second = new ReadableFakeGpuBackend(canvas);
    const runtime = new EngineRuntime(
      first,
      canvas,
      platform,
      {},
      { onFrame: (report) => reports.push(report), onFault: (error) => faults.push(error) },
      { recreateBackend: () => Promise.resolve({ backend: second }) },
    );
    return { platform, runtime, reports, faults, first, second };
  }

  it('rebuilds on a new backend and draws the whole document again', async () => {
    const { platform, runtime, reports, faults, first, second } = setUpRecoverable();
    runtime.applyChangeSet(boardChange());
    runtime.setCamera(CAMERA);
    platform.runFrame(16);

    first.loseDevice();
    await flush();
    expect(platform.pendingFrames).toBe(1);
    platform.runFrame(32);

    expect(faults).toEqual([]);
    expect(runtime.renderer.scene.objectCount).toBe(2);
    // Shapes are the SDF shape pass's.
    expect(second.writes().map(({ label }) => label)).toContain('sdf-shape instances');
    expect(second.draws()).toHaveLength(1);
    expect(reports.at(-1)?.stats.changedObjects).toBe(2);
  });

  it('keeps the dot grid shown across the rebuild', async () => {
    const { platform, runtime, first, second } = setUpRecoverable();
    runtime.setCamera(CAMERA);
    runtime.view.setGridVisible(true);
    platform.runFrame(16);

    first.loseDevice();
    await flush();
    platform.runFrame(32);

    const pipelines = second.calls.flatMap((call) =>
      call.method === 'setPipeline' ? [call.label] : [],
    );
    expect(pipelines).toContain('dot-grid');
  });

  it('cancels the frame that was waiting when the device was lost', () => {
    const { platform, runtime, first } = setUpRecoverable();
    runtime.setCamera(CAMERA);
    const waitingBefore = platform.pendingFrames;

    first.loseDevice(new Promise<void>(() => undefined));

    expect([waitingBefore, platform.pendingFrames]).toEqual([1, 0]);
  });

  it('draws nothing while the canvas waits to be restored', async () => {
    const { platform, runtime, first } = setUpRecoverable();
    runtime.setCamera(CAMERA);
    platform.runFrame(16);
    let restore: () => void = () => undefined;
    first.loseDevice(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    await flush();

    runtime.requestFrame();
    expect(platform.pendingFrames).toBe(0);

    restore();
    await flush();
    expect(platform.pendingFrames).toBe(1);
  });

  it('keeps recording frame statistics across the rebuild', async () => {
    const { platform, runtime, first } = setUpRecoverable();
    runtime.setCamera(CAMERA);
    runtime.startFrameStats(10);
    platform.runFrame(16);

    first.loseDevice();
    await flush();
    platform.runFrame(32);

    expect(runtime.readFrameStats().runFrames).toBe(2);
  });

  it('frees a new backend that arrives after the runtime was destroyed', async () => {
    const { platform, runtime, first, second } = setUpRecoverable();
    runtime.setCamera(CAMERA);
    platform.runFrame(16);
    let restore: () => void = () => undefined;
    first.loseDevice(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    const destroy = vi.spyOn(second, 'destroy');

    runtime.destroy();
    restore();
    await flush();

    expect(destroy).toHaveBeenCalledOnce();
    expect(platform.pendingFrames).toBe(0);
  });

  it('reports a new backend that fails to start as a fault', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const faults: Error[] = [];
    const first = new ReadableFakeGpuBackend(canvas);
    const runtime = new EngineRuntime(
      first,
      canvas,
      platform,
      {},
      { onFrame: () => undefined, onFault: (error) => faults.push(error) },
      { recreateBackend: () => Promise.reject(new Error('no adapter')) },
    );
    runtime.setCamera(CAMERA);
    platform.runFrame(16);

    first.loseDevice();
    await flush();

    expect(faults.map(({ message }) => message)).toEqual(['no adapter']);
  });

  it('reports the loss as a fault when it cannot build a new backend', () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const faults: Error[] = [];
    const backend = new ReadableFakeGpuBackend(canvas);
    const runtime = new EngineRuntime(
      backend,
      canvas,
      platform,
      {},
      {
        onFrame: () => undefined,
        onFault: (error) => faults.push(error),
      },
    );
    runtime.setCamera(CAMERA);
    platform.runFrame(16);

    backend.loseDevice();

    expect(faults.map(({ message }) => message)).toEqual([
      'The GPU device was lost: fake device lost',
    ]);
  });

  it('draws each image from its smallest level on the first frame after the rebuild', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(1000, 800);
    const first = new ReadableFakeGpuBackend(canvas);
    const second = new ReadableFakeGpuBackend(canvas);
    // No job workers: the pool decodes on this thread, and the test records what it decodes.
    const decoded: (readonly number[])[] = [];
    const decode = createDecodeJobHandler();
    const decodeFallback: JobHandler<'decode'> = (request) => {
      decoded.push(request.longEdgesPx);
      return decode(request);
    };
    const reports: EngineFrameReport[] = [];
    const assets = createFixtureAssetSource(1, {
      assets: { photo: { naturalSize: { width: 4000, height: 3000 } } },
    });
    const runtime = new EngineRuntime(
      first,
      canvas,
      platform,
      {},
      { onFrame: (report) => reports.push(report), onFault: () => undefined },
      {
        images: { assets, decodeFallback },
        recreateBackend: () => Promise.resolve({ backend: second }),
      },
    );
    const document = new FakeSceneDocument();
    document.create(imageObject());
    runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
    runtime.setCamera({ ...CAMERA, viewportWidthPx: 1000, viewportHeightPx: 800 });
    for (let frame = 0; frame < 6 && platform.pendingFrames > 0; frame += 1) {
      platform.runFrame(16 * (frame + 1));
      await flushMicrotasks();
    }
    const decodedBefore = decoded.length;

    first.loseDevice();
    await flush();
    platform.runFrame(200);

    expect(reports.at(-1)?.stats.blankImages).toBe(0);
    expect(second.liveTextures().map(({ label }) => label)).toContain('image atlas 0');
    // The smallest level came from its CPU copy; only the larger one is decoded again.
    for (let frame = 0; frame < 6; frame += 1) {
      await flushMicrotasks();
      if (platform.pendingFrames > 0) platform.runFrame(216 + 16 * frame);
    }
    expect(decoded.slice(decodedBefore)).toEqual([[512]]);
  });
});
