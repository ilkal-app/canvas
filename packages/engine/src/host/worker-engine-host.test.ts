import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';

import { FakeCanvas } from './__fixtures__/fake-host-platform.js';
import { InMemoryEngineWorker, settle } from './__fixtures__/in-memory-engine-worker.js';
import { recordingOverlays } from './__fixtures__/recording-overlay.js';
import type { EngineFrameReport } from './engine-host.js';
import { overlayLayerModel } from './layered-overlay.js';
import { serializeChangeSet } from './serializable-change-set.js';
import { WorkerEngineHost } from './worker-engine-host.js';

/**
 * The red channel of each pixel.
 *
 * @param rgba - RGBA8 pixels.
 * @returns One value per pixel.
 */
function redChannel(rgba: Uint8Array): number[] {
  return [...rgba].filter((value, index) => index % 4 === 0);
}

const PAGE_TIME_ORIGIN_MS = 1_000_000;
const WORKER_TIME_ORIGIN_MS = 1_000_500;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

async function startHost(worker = new InMemoryEngineWorker(WORKER_TIME_ORIGIN_MS)): Promise<{
  worker: InMemoryEngineWorker;
  host: WorkerEngineHost;
  reports: EngineFrameReport[];
  faults: Error[];
}> {
  const created = WorkerEngineHost.create(worker, new FakeCanvas(4, 2), PAGE_TIME_ORIGIN_MS, {
    backend: 'webgl2',
    sampleCount: 1,
  });
  await settle();
  const host = await created;
  const reports: EngineFrameReport[] = [];
  const faults: Error[] = [];
  host.onFrame((report) => reports.push(report));
  host.onFault((error) => faults.push(error));
  return { worker, host, reports, faults };
}

describe('WorkerEngineHost', () => {
  it('starts the engine in the worker with the canvas and options, and reports its backend', async () => {
    const { worker, host } = await startHost();
    expect(host.kind).toBe('worker');
    expect(host.capabilities.adapterName).toBe('fake');
    expect(worker.received[0]).toMatchObject({
      type: 'engine-init',
      canvas: { width: 4, height: 2 },
      options: { backend: 'webgl2', sampleCount: 1 },
    });
    expect(worker.platform.backendOptions).toEqual([{ prefer: 'webgl2', sampleCount: 1 }]);
  });

  it('posts the calls of one task as one message, which the worker draws in one frame', async () => {
    const { worker, host, reports } = await startHost();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b'));
    host.applyChangeSet(serializeChangeSet(document.takeChanges()));
    host.setCamera(CAMERA);
    host.pointer({ type: 'down', xPx: 1, yPx: 1, buttons: 1, pointerId: 1, timestampMs: 42 });
    await worker.runFrame(16);
    expect(worker.received.map(({ type }) => type)).toEqual(['engine-init', 'engine-commands']);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.stats).toMatchObject({ changedObjects: 2, drawCalls: 1 });
    expect(reports[0]?.pointerInputs.map(({ timestampMs }) => timestampMs)).toEqual([42]);
  });

  it('shows and hides the dot grid in the worker, one draw more under the scene', async () => {
    const { worker, host, reports } = await startHost();
    host.setCamera(CAMERA);
    host.setGridVisible(true);
    await worker.runFrame(16);
    expect(reports[0]?.stats.drawCalls).toBe(1);
    host.setGridVisible(false);
    await worker.runFrame(32);
    expect(reports[1]?.stats.drawCalls).toBe(0);
  });

  it("converts frame times from the worker's clock to the page's", async () => {
    const { worker, host, reports } = await startHost();
    host.setCamera(CAMERA);
    await worker.runFrame(100);
    expect(reports[0]?.frameTimeMs).toBe(100 + WORKER_TIME_ORIGIN_MS - PAGE_TIME_ORIGIN_MS);
  });

  it('keeps animating in the worker without any further message from the page', async () => {
    const { worker, host, reports } = await startHost();
    host.setCamera(CAMERA);
    await worker.runFrame(0);
    host.animateCamera({ ...CAMERA, zoom: 8 }, 90);
    await settle();
    const messagesBefore = worker.received.length;
    for (const timeMs of [10, 40, 70, 100]) await worker.runFrame(timeMs);
    expect(worker.received).toHaveLength(messagesBefore);
    const zooms = reports.map(({ camera }) => Math.round((camera?.zoom ?? 0) * 1e6) / 1e6);
    expect(zooms).toEqual([1, 1, 2, 4, 8]);
  });

  it("answers a frameless worker's asks with one tick each at the page's next frame", async () => {
    const { worker, host } = await startHost();
    worker.deliver({ type: 'engine-needs-frame-tick' });
    worker.deliver({ type: 'engine-needs-frame-tick' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ticks = (): number =>
      worker.received.filter(({ type }) => type === 'engine-frame-tick').length;
    expect(ticks()).toBe(1);
    worker.deliver({ type: 'engine-needs-frame-tick' });
    host.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ticks()).toBe(1);
  });

  it('resizes the canvas in the worker', async () => {
    const { worker, host, reports } = await startHost();
    host.setCamera(CAMERA);
    host.resize(8, 6, 2);
    await worker.runFrame(0);
    expect(reports[0]?.camera).toMatchObject({ viewportWidthPx: 4, viewportHeightPx: 3, dpr: 2 });
  });

  it('reads pixels in the worker frame and receives them as a transferred copy', async () => {
    const { worker, host } = await startHost();
    host.setCamera(CAMERA);
    host.requestFrame();
    const read = host.readPixels({ xPx: 2, yPx: 1, widthPx: 2, heightPx: 1 });
    await worker.runFrame(0);
    const pixels = await read;
    expect(redChannel(pixels.rgba)).toEqual([6, 7]);
    expect(worker.platform.backends[0]?.readCount).toBe(1);
  });

  it('rejects a read the worker could not answer with the worker error', async () => {
    const { worker, host } = await startHost();
    host.setCamera(CAMERA);
    const read = host.readPixels({ xPx: 0, yPx: 0, widthPx: 9, heightPx: 1 });
    await worker.runFrame(0);
    await expect(read).rejects.toMatchObject({ name: 'RangeError' });
  });

  it('reports worker failures, frame errors and malformed messages as faults', async () => {
    const { worker, host, faults } = await startHost();
    host.resize(0, 1, 1);
    await settle();
    worker.deliver({ type: 'engine-frame' });
    worker.deliver({ type: 'engine-ready', capabilities: {}, timeOriginMs: 0 });
    const read = host.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    worker.crash(new Error('out of memory'));
    await expect(read).rejects.toThrow('out of memory');
    expect(faults.map(({ name, message }) => `${name}: ${message}`)).toEqual([
      expect.stringMatching(/^RangeError: A canvas size/),
      'TypeError: The engine worker sent a malformed message.',
      'Error: The engine worker reported ready twice.',
      'Error: out of memory',
    ]);
  });

  it('throws a fault when nobody listens for faults', async () => {
    const worker = new InMemoryEngineWorker();
    const created = WorkerEngineHost.create(worker, new FakeCanvas(), PAGE_TIME_ORIGIN_MS);
    await settle();
    await created;
    expect(() => {
      worker.crash(new Error('lost'));
    }).toThrow('lost');
  });

  it('fails to start, terminating the worker, when the worker cannot create a backend', async () => {
    const worker = new InMemoryEngineWorker();
    worker.platform.backendFailure = new Error('no GPU in this worker');
    const created = WorkerEngineHost.create(worker, new FakeCanvas(), PAGE_TIME_ORIGIN_MS);
    await settle();
    await expect(created).rejects.toThrow('no GPU in this worker');
    expect(worker.isTerminated).toBe(true);
  });

  it('fails to start when the worker script fails or the init cannot be posted', async () => {
    const crashing = new InMemoryEngineWorker();
    const crashed = WorkerEngineHost.create(crashing, new FakeCanvas(), PAGE_TIME_ORIGIN_MS);
    crashing.crash(new Error('script failed to load'));
    await expect(crashed).rejects.toThrow('script failed to load');
    const terminated = new InMemoryEngineWorker();
    terminated.terminate();
    await expect(
      WorkerEngineHost.create(terminated, new FakeCanvas(), PAGE_TIME_ORIGIN_MS),
    ).rejects.toThrow('terminated');
  });

  it('terminates the worker on destroy, rejects waiting reads and ignores later calls', async () => {
    const { worker, host } = await startHost();
    host.setCamera(CAMERA);
    const read = host.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    host.destroy();
    await expect(read).rejects.toThrow(/destroyed/);
    expect(worker.isTerminated).toBe(true);
    host.setCamera(CAMERA);
    host.destroy();
    await settle();
    expect(worker.received.map(({ type }) => type)).toEqual(['engine-init']);
    await expect(host.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 })).rejects.toThrow(
      /destroyed/,
    );
  });

  it('reports a batch that cannot be posted as a fault and rejects the reads in it', async () => {
    const { worker, host, faults, reports } = await startHost();
    const unsubscribe = host.onFrame(() => undefined);
    unsubscribe();
    worker.terminate();
    const read = host.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    await expect(read).rejects.toThrow('Posted to a terminated worker.');
    expect(faults.map(({ message }) => message)).toEqual(['Posted to a terminated worker.']);
    expect(reports).toEqual([]);
  });

  it('reports a frame that throws in the worker as a fault', async () => {
    const { worker, host, faults } = await startHost();
    host.setCamera(CAMERA);
    await settle();
    const backend = worker.platform.backends[0];
    if (backend) backend.submitFailure = new Error('device lost in the worker');
    await worker.runFrame(0);
    expect(faults.map(({ message }) => message)).toEqual(['device lost in the worker']);
  });

  it('reads the frame statistics the worker records once they are started', async () => {
    const { worker, host } = await startHost();
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    host.startFrameStats(8);
    host.applyChangeSet(serializeChangeSet(document.takeChanges()));
    host.setCamera(CAMERA);
    await worker.runFrame(16);
    const read = host.readFrameStats();
    await settle();
    await expect(read).resolves.toMatchObject({ frames: 1, p50: { changedObjects: 1 } });
    expect(worker.received.at(-1)).toMatchObject({
      type: 'engine-commands',
      commands: [{ type: 'read-frame-stats' }],
    });
    host.stopFrameStats();
    const afterStop = host.readFrameStats();
    await settle();
    await expect(afterStop).rejects.toThrow(/startFrameStats/);
  });

  it('rejects a statistics read the worker cannot answer, and one after destroy', async () => {
    const { host } = await startHost();
    const read = host.readFrameStats();
    await settle();
    await expect(read).rejects.toThrow(/startFrameStats/);
    host.destroy();
    await expect(host.readFrameStats()).rejects.toThrow(/destroyed/);
  });

  it('rejects a read the worker answers with the other kind of answer', async () => {
    const { worker, host } = await startHost();
    const read = host.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    const id = 1;
    worker.deliver({ type: 'engine-frame-stats', id, sample: {} });
    await expect(read).rejects.toThrow(/pixels read/);
  });

  it("sends one overlay model per task, the last, and the worker's layer draws it with the change sets", async () => {
    const overlays = recordingOverlays();
    const worker = new InMemoryEngineWorker(WORKER_TIME_ORIGIN_MS, {
      createOverlay: overlays.create,
    });
    const { host, reports } = await startHost(worker);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    host.setOverlay({ label: 'pressed' });
    host.applyChangeSet(serializeChangeSet(document.takeChanges()));
    host.setOverlay({ label: 'dragged' });
    host.setCamera(CAMERA);
    await worker.runFrame(16);
    const commands = worker.received.flatMap((message) =>
      message.type === 'engine-commands' ? message.commands.map(({ type }) => type) : [],
    );
    expect(commands).toEqual(['overlay', 'change-set', 'camera']);
    expect(overlays.layers[0]?.drawn).toEqual(['dragged']);
    expect(reports[0]?.stats.changedObjects).toBe(1);
  });

  it('keeps one overlay model per layer per task, so a named layer and the base both arrive', async () => {
    const worker = new InMemoryEngineWorker(WORKER_TIME_ORIGIN_MS);
    const { host } = await startHost(worker);
    host.setOverlay(overlayLayerModel('peers', 'old box'));
    host.setOverlay({ label: 'pressed' });
    host.setOverlay(overlayLayerModel('peers', 'moved box'));
    host.setOverlay({ label: 'dragged' });
    await worker.runFrame(16);
    const models = worker.received.flatMap((message) =>
      message.type === 'engine-commands'
        ? message.commands.flatMap((command) => (command.type === 'overlay' ? [command.model] : []))
        : [],
    );
    expect(models).toEqual([overlayLayerModel('peers', 'moved box'), { label: 'dragged' }]);
  });

  it('reports an overlay model the worker has no layer for, or refuses, as a fault', async () => {
    const plain = await startHost();
    plain.host.setOverlay({ label: 'lost' });
    plain.host.setCamera(CAMERA);
    await plain.worker.runFrame(0);
    expect(plain.faults.map(({ message }) => message)).toEqual([
      'The engine has no overlay layer to show a model on.',
    ]);
    const overlays = recordingOverlays();
    const worker = new InMemoryEngineWorker(WORKER_TIME_ORIGIN_MS, {
      createOverlay: overlays.create,
    });
    const { host, faults } = await startHost(worker);
    host.setOverlay('not a model');
    host.setCamera(CAMERA);
    await worker.runFrame(0);
    expect(faults.map(({ name }) => name)).toEqual(['TypeError']);
  });

  it("returns the frame statistics at each poll, the overlay layer's stage included", async () => {
    const overlays = recordingOverlays();
    const worker = new InMemoryEngineWorker(WORKER_TIME_ORIGIN_MS, {
      createOverlay: overlays.create,
    });
    const { host } = await startHost(worker);
    host.startFrameStats();
    host.setCamera(CAMERA);
    await worker.runFrame(16);
    const first = host.readFrameStats();
    await settle();
    host.requestFrame();
    await worker.runFrame(32);
    const second = host.readFrameStats();
    await settle();
    await expect(first).resolves.toMatchObject({ frames: 1 });
    const sample = await second;
    expect(sample.frames).toBe(2);
    expect(Object.keys(sample.stages)).toContain('recordingOverlay');
  });

  it('reports a capacity the worker refuses as a fault', async () => {
    const { host, faults } = await startHost();
    host.startFrameStats(0);
    await settle();
    expect(faults.map(({ name }) => name)).toEqual(['RangeError']);
  });
});
