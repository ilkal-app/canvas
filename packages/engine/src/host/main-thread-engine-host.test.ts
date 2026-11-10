import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { FakeCanvas, FakeHostPlatform } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { recordingOverlays } from './__fixtures__/recording-overlay.js';
import { backendOptionsOf } from './backend-options.js';
import type { EngineFrameReport, EngineHost } from './engine-host.js';
import { MainThreadEngineHost } from './main-thread-engine-host.js';
import { serializeChangeSet } from './serializable-change-set.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

/**
 * Drives a host through a scripted session.
 *
 * @param host - The host.
 * @param runFrame - Runs the host's next frame at a time, ms.
 * @returns Its frame reports, their times zeroed so hosts on different clocks compare.
 */
async function script(
  host: EngineHost,
  runFrame: (timeMs: number) => Promise<void>,
): Promise<EngineFrameReport[]> {
  const reports: EngineFrameReport[] = [];
  host.onFrame((report) => reports.push({ ...report, frameTimeMs: 0 }));
  const document = new FakeSceneDocument();
  document.create(frameObject('f', { x: 2 }), shapeObject('s', { parentId: 'f' }));
  host.applyChangeSet(serializeChangeSet(document.takeChanges()));
  host.setCamera(CAMERA);
  await runFrame(0);
  document.update('f', { x: 5 });
  host.applyChangeSet(serializeChangeSet(document.takeChanges()));
  host.pointer({ type: 'move', xPx: 1, yPx: 1, buttons: 0, pointerId: 1, timestampMs: 3 });
  await runFrame(16);
  host.animateCamera({ ...CAMERA, zoom: 4 }, 32);
  for (const timeMs of [32, 48, 64]) await runFrame(timeMs);
  return reports;
}

describe('MainThreadEngineHost', () => {
  it('creates its backend on the page canvas with the requested options', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform, {
      backend: 'webgl2',
    });
    expect(host.kind).toBe('main');
    expect(host.capabilities.adapterName).toBe('fake');
    expect(platform.backendOptions).toEqual([{ prefer: 'webgl2' }]);
    expect(backendOptionsOf({})).toEqual({ prefer: 'webgpu' });
  });

  it('reports the same frames as the worker host for the same calls', async () => {
    const platform = new FakeHostPlatform();
    const main = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    const mainReports = await script(main, (timeMs) => {
      platform.runFrame(timeMs);
      return Promise.resolve();
    });
    const worker = new InMemoryEngineWorker();
    const created = WorkerEngineHost.create(worker, new FakeCanvas(), platform.timeOriginMs);
    await settle();
    const workerReports = await script(await created, (timeMs) => worker.runFrame(timeMs));
    expect(mainReports).toHaveLength(5);
    expect(workerReports).toEqual(mainReports);
  });

  it('reads pixels and resizes on the page canvas', async () => {
    const platform = new FakeHostPlatform();
    const canvas = new FakeCanvas(4, 2);
    const host = await MainThreadEngineHost.create(canvas, platform);
    host.setCamera(CAMERA);
    host.resize(6, 2, 1);
    host.requestFrame();
    const read = host.readPixels({ xPx: 5, yPx: 1, widthPx: 1, heightPx: 1 });
    platform.runFrame(0);
    expect((await read).rgba[0]).toBe(11);
    expect(canvas.width).toBe(6);
  });

  it('delivers a failed frame to fault listeners, and throws it from the frame when none listen', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    const backend = platform.backends[0];
    if (backend === undefined) throw new Error('No backend was created.');
    const faults: Error[] = [];
    const unsubscribe = host.onFault((error) => faults.push(error));
    host.setCamera(CAMERA);
    backend.submitFailure = new Error('device lost');
    platform.runFrame(0);
    expect(faults.map(({ message }) => message)).toEqual(['device lost']);
    unsubscribe();
    host.requestFrame();
    backend.submitFailure = new Error('device lost again');
    expect(() => {
      platform.runFrame(16);
    }).toThrow('device lost again');
  });

  it('draws overlay models with the layer it was given', async () => {
    const platform = new FakeHostPlatform();
    const overlays = recordingOverlays();
    const host = await MainThreadEngineHost.create(
      new FakeCanvas(),
      platform,
      {},
      {
        createOverlay: overlays.create,
      },
    );
    host.setOverlay({ label: 'selection' });
    host.setCamera(CAMERA);
    platform.runFrame(0);
    expect(overlays.layers[0]?.drawn).toEqual(['selection']);
    host.destroy();
    expect(overlays.layers[0]?.isDestroyed).toBe(true);
  });

  it('draws the dot grid on the page once shown', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    const drawCalls: number[] = [];
    host.onFrame((report) => drawCalls.push(report.stats.drawCalls));
    host.setCamera(CAMERA);
    host.setGridVisible(true);
    platform.runFrame(0);
    expect(drawCalls).toEqual([1]);
  });

  it('frees its backend on destroy', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    host.destroy();
    expect(platform.backends[0]?.isDestroyed).toBe(true);
  });

  it('reads the frame statistics once they are started, and rejects a read before', async () => {
    const platform = new FakeHostPlatform();
    const host = await MainThreadEngineHost.create(new FakeCanvas(), platform);
    await expect(host.readFrameStats()).rejects.toThrow(/startFrameStats/);
    host.startFrameStats(8);
    host.setCamera(CAMERA);
    platform.runFrame(0);
    await expect(host.readFrameStats()).resolves.toMatchObject({ frames: 1, runFrames: 1 });
    host.stopFrameStats();
    await expect(host.readFrameStats()).rejects.toThrow(/startFrameStats/);
  });
});
