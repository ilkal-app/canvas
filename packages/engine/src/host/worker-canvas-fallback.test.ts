import { describe, expect, it, vi } from 'vitest';

import type { CreateGpuBackendOptions } from '../gpu/create-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { FakeCanvas } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import type { EngineCanvas } from './engine-host-platform.js';
import type { EngineFrameReport } from './engine-host.js';
import { serializeChangeSet } from './serializable-change-set.js';
import type { WorkerCanvasFallback } from './worker-canvas-fallback.js';
import { WorkerEngineHost } from './worker-engine-host.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

/** A page canvas stand-in: what the overlay needs of a DOM canvas. */
class PageCanvas extends FakeCanvas {
  readonly style: Record<string, string> = {};
  readonly inserted: PageCanvas[] = [];
  readonly ownerDocument = { createElement: () => new PageCanvas(this.width, this.height) };
  isRemoved = false;

  after(canvas: PageCanvas): void {
    this.inserted.push(canvas);
  }

  remove(): void {
    this.isRemoved = true;
  }
}

/**
 * A worker whose backends are named after the backend they were asked for.
 *
 * @returns The worker.
 */
function switchingWorker(): InMemoryEngineWorker {
  const worker = new InMemoryEngineWorker();
  const { platform } = worker;
  const create = platform.createBackend.bind(platform);
  platform.createBackend = async (canvas: EngineCanvas, options: CreateGpuBackendOptions) => {
    const backend = await create(canvas, options);
    Object.assign(backend.capabilities, { backendName: options.prefer });
    return backend;
  };
  return worker;
}

async function startDrawing(fallback?: WorkerCanvasFallback) {
  const worker = switchingWorker();
  const created = WorkerEngineHost.create(
    worker,
    new FakeCanvas(4, 2),
    1_000_000,
    { backend: 'webgpu' },
    undefined,
    fallback,
  );
  await settle();
  const host = await created;
  const reports: EngineFrameReport[] = [];
  const faults: Error[] = [];
  host.onFrame((report) => reports.push(report));
  host.onFault((error) => faults.push(error));
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'));
  host.applyChangeSet(serializeChangeSet(document.takeChanges()));
  host.setCamera(CAMERA);
  await worker.runFrame(16);
  return { worker, host, reports, faults };
}

describe('a worker engine after a WebGPU loss', () => {
  it('lays a fresh canvas over the page canvas, hands it over and draws on it with WebGL2', async () => {
    const pageCanvas = new PageCanvas(4, 2);
    const offscreens: EngineCanvas[] = [];
    const onBackendChanged = vi.fn();
    const { worker, host, reports, faults } = await startDrawing({
      pageCanvas,
      transferControlToOffscreen: (canvas) => {
        const offscreen = new FakeCanvas(canvas.width, canvas.height);
        offscreens.push(offscreen);
        return offscreen;
      },
      onBackendChanged,
    });
    host.loseDeviceForTesting();
    await settle();
    await settle();

    expect(pageCanvas.inserted).toHaveLength(1);
    expect(pageCanvas.style.opacity).toBe('0');
    expect(worker.received.at(-1)).toMatchObject({ type: 'engine-fallback-canvas' });
    expect(worker.transfers.at(-1)).toEqual(offscreens);
    expect(worker.platform.backendOptions.at(-1)).toEqual({ prefer: 'webgl2' });
    expect(host.capabilities.backendName).toBe('webgl2');
    expect(onBackendChanged.mock.calls).toEqual([['webgl2']]);

    await worker.runFrame(32);
    expect(reports.at(-1)?.stats).toMatchObject({ drawCalls: 1 });
    host.resize(8, 6, 2);
    expect(pageCanvas.inserted[0]?.style).toMatchObject({ width: '4px', height: '3px' });
    expect(faults).toEqual([]);

    host.destroy();
    expect(pageCanvas.inserted[0]?.isRemoved).toBe(true);
    expect(pageCanvas.style.opacity).toBe('');
  });

  it('retries WebGPU on its own canvas when the page cannot give it one', async () => {
    const { worker, host, faults } = await startDrawing();
    host.loseDeviceForTesting();
    await settle();
    await settle();
    expect(worker.received.at(-1)).toEqual({ type: 'engine-fallback-canvas' });
    expect(worker.platform.backendOptions.map(({ prefer }) => prefer)).toEqual([
      'webgpu',
      'webgpu',
    ]);
    expect(host.capabilities.backendName).toBe('webgpu');
    expect(faults).toEqual([]);
  });

  it('reports a canvas it cannot hand over, takes it off the page and still answers', async () => {
    const pageCanvas = new PageCanvas();
    const { worker, host, faults } = await startDrawing({
      pageCanvas,
      transferControlToOffscreen: () => {
        throw new Error('already handed over');
      },
    });
    worker.platform.backends.at(-1)?.loseDevice();
    await settle();
    await settle();
    expect(faults.map(({ message }) => message)).toEqual(['already handed over']);
    expect(pageCanvas.inserted[0]?.isRemoved).toBe(true);
    expect(pageCanvas.style.opacity).toBe('');
    // The worker was answered with no canvas, so it went on with WebGPU in place.
    expect(worker.received.at(-1)).toEqual({ type: 'engine-fallback-canvas' });
    expect(worker.platform.backends).toHaveLength(2);
    expect(host.capabilities.backendName).toBe('webgpu');
  });

  it('reports a fallback canvas the worker never asked for', async () => {
    const stray = await startDrawing();
    stray.worker.post({ type: 'engine-fallback-canvas', canvas: new FakeCanvas() }, []);
    await settle();
    expect(stray.faults.map(({ message }) => message)).toEqual([
      'The engine worker received a canvas it did not ask for.',
    ]);
  });
});
