import { describe, expect, it, vi } from 'vitest';

import type { EngineFrameListener, EngineFrameReport, EngineHost } from '@canvas/engine';

import { attachEngineHarness } from './attach-engine-harness.js';
import type { EngineHarnessCanvas } from './engine-harness.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

// A host stand-in: records calls and lets the test emit frame reports.
function fakeHost(): {
  host: EngineHost;
  calls: {
    applyChangeSet: unknown[][];
    setCamera: unknown[][];
    animateCamera: unknown[][];
    startFrameStats: unknown[][];
    stopFrameStats: unknown[][];
    setGridVisible: unknown[][];
    setOverlay: unknown[][];
    setTheme: unknown[][];
  };
  emit: (report: EngineFrameReport) => void;
} {
  const listeners = new Set<EngineFrameListener>();
  const calls = {
    applyChangeSet: [] as unknown[][],
    setCamera: [] as unknown[][],
    animateCamera: [] as unknown[][],
    startFrameStats: [] as unknown[][],
    stopFrameStats: [] as unknown[][],
    setGridVisible: [] as unknown[][],
    setOverlay: [] as unknown[][],
    setTheme: [] as unknown[][],
  };
  const host = {
    kind: 'worker',
    capabilities: {
      backendName: 'webgpu',
      adapterName: 'Apple M1',
      isSoftwareAdapter: false,
      hasTimestampQuery: true,
    },
    onFrame: (listener: EngineFrameListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyChangeSet: (...args: unknown[]) => calls.applyChangeSet.push(args),
    setCamera: (...args: unknown[]) => calls.setCamera.push(args),
    animateCamera: (...args: unknown[]) => calls.animateCamera.push(args),
    startFrameStats: (...args: unknown[]) => calls.startFrameStats.push(args),
    stopFrameStats: (...args: unknown[]) => calls.stopFrameStats.push(args),
    setGridVisible: (...args: unknown[]) => calls.setGridVisible.push(args),
    setOverlay: (...args: unknown[]) => calls.setOverlay.push(args),
    setTheme: (...args: unknown[]) => calls.setTheme.push(args),
    readFrameStats: () => Promise.resolve({ frames: 3 }),
  } as unknown as EngineHost;
  return {
    host,
    calls,
    emit: (report) => {
      for (const listener of listeners) listener(report);
    },
  };
}

function report(frameIndex: number): EngineFrameReport {
  return {
    frameIndex,
    frameTimeMs: frameIndex * 16,
    camera: undefined,
    drawingBuffer: { widthPx: 4, heightPx: 2 },
    stats: {
      changedObjects: 0,
      bufferWrites: 0,
      uploadedBytes: 0,
      drawCalls: 0,
      blankImages: 0,
      placeholderImages: 0,
      visibleImages: 0,
      segments: 0,
      carriedAdmissions: 0,
      lodTransitions: 0,
      lodThrashes: 0,
      atlasRegenerations: 0,
      atlasLookups: 0,
      atlasMisses: 0,
      meshRegenerations: 0,
      vectorTextRuns: 0,
      layersDrawn: 0,
      layersFallbackSmall: 0,
      layersFallbackLimit: 0,
      layersFallbackBudget: 0,
      layerBytes: 0,
      renderPasses: 0,
      pipelineSwitches: 0,
      bindGroupChanges: 0,
    },
    pointerInputs: [],
    hasPendingWork: false,
    isUsingJobWorkers: false,
  };
}

describe('attachEngineHarness', () => {
  it('records frames and drives the host from the canvas, until detached', () => {
    const { host, calls, emit } = fakeHost();
    const canvas = {} as EngineHarnessCanvas;
    const detach = attachEngineHarness(host, canvas);
    const harness = canvas.engineHarness;
    expect(harness).toMatchObject({
      hostKind: 'worker',
      backendName: 'webgpu',
      adapterName: 'Apple M1',
      isSoftwareAdapter: false,
      hasTimestampQuery: true,
    });
    emit(report(0));
    emit(report(1));
    expect(harness?.frames().map(({ frameIndex }) => frameIndex)).toEqual([0, 1]);
    // The reports carried no pointer input, and jsdom has no long tasks.
    expect(harness?.inputLatenciesMs(0)).toEqual([]);
    expect(harness?.pageLongTasks(0)).toEqual([]);
    const changes = { created: [], updated: [], deleted: [], objects: {} };
    harness?.applyChangeSet(changes);
    harness?.setCamera(CAMERA);
    harness?.animateCamera(CAMERA, 100);
    harness?.startFrameStats(600);
    harness?.stopFrameStats();
    harness?.setGridVisible(true);
    harness?.showTraceTint({ sheets: [] });
    harness?.setTheme('dark');
    expect(calls).toEqual({
      applyChangeSet: [[changes]],
      setCamera: [[CAMERA]],
      animateCamera: [[CAMERA, 100]],
      startFrameStats: [[600]],
      stopFrameStats: [[]],
      setGridVisible: [[true]],
      setOverlay: [[{ overlayLayer: 'traceTint', model: { sheets: [] } }]],
      setTheme: [['dark', expect.anything()]],
    });
    detach();
    emit(report(2));
    expect(canvas.engineHarness).toBeUndefined();
    expect(harness?.frames()).toHaveLength(2);
  });

  it('reads the backend live and loses the device through the host', () => {
    const { host } = fakeHost();
    const loseDeviceForTesting = vi.fn();
    Object.assign(host, { loseDeviceForTesting });
    const canvas = {} as EngineHarnessCanvas;
    const detach = attachEngineHarness(host, canvas);
    canvas.engineHarness?.loseDeviceForTesting();
    expect(loseDeviceForTesting).toHaveBeenCalledOnce();
    Object.assign(host, {
      capabilities: {
        backendName: 'webgl2',
        adapterName: 'ANGLE',
        isSoftwareAdapter: true,
        hasTimestampQuery: false,
      },
    });
    expect(canvas.engineHarness).toMatchObject({
      backendName: 'webgl2',
      adapterName: 'ANGLE',
      isSoftwareAdapter: true,
      hasTimestampQuery: false,
    });
    detach();
  });

  it('waits for the board idle as told, at once when not told', async () => {
    const { host } = fakeHost();
    const bare = {} as EngineHarnessCanvas;
    attachEngineHarness(host, bare);
    await expect(bare.engineHarness?.whenStoreIdle?.()).resolves.toBeUndefined();
    const told = {} as EngineHarnessCanvas;
    const whenStoreIdle = vi.fn(() => Promise.resolve());
    attachEngineHarness(host, told, undefined, undefined, whenStoreIdle);
    await told.engineHarness?.whenStoreIdle?.();
    expect(whenStoreIdle).toHaveBeenCalledOnce();
  });

  it('acknowledges a frame through the host, else with the latest frame', async () => {
    const { host, emit } = fakeHost();
    const bare = {} as EngineHarnessCanvas;
    attachEngineHarness(host, bare);
    await expect(bare.engineHarness?.acknowledgeFrame?.()).resolves.toBe(0);
    emit(report(7));
    await expect(bare.engineHarness?.acknowledgeFrame?.()).resolves.toBe(7);
    const barred = {} as EngineHarnessCanvas;
    attachEngineHarness(
      { ...host, requestFrameAcknowledgement: () => Promise.resolve(12) },
      barred,
    );
    await expect(barred.engineHarness?.acknowledgeFrame?.()).resolves.toBe(12);
  });

  it('reads the frame statistics the host records', async () => {
    const { host } = fakeHost();
    const canvas = {} as EngineHarnessCanvas;
    attachEngineHarness(host, canvas);
    await expect(canvas.engineHarness?.readFrameStats()).resolves.toEqual({ frames: 3 });
  });

  it('keeps only the last thousand frames', () => {
    const { host, emit } = fakeHost();
    const canvas = {} as EngineHarnessCanvas;
    attachEngineHarness(host, canvas);
    for (let index = 0; index < 1_005; index += 1) emit(report(index));
    const frames = canvas.engineHarness?.frames() ?? [];
    expect(frames).toHaveLength(1_000);
    expect(frames[0]?.frameIndex).toBe(5);
  });

  it("loads objects into the page's document when the mount gives it a loader", () => {
    const { host } = fakeHost();
    const loaded: unknown[] = [];
    const withDocument = {} as EngineHarnessCanvas;
    attachEngineHarness(host, withDocument, (objects) => loaded.push(objects));
    withDocument.engineHarness?.loadDocument([]);
    expect(loaded).toEqual([[]]);
    const withoutDocument = {} as EngineHarnessCanvas;
    attachEngineHarness(host, withoutDocument);
    expect(() => withoutDocument.engineHarness?.loadDocument([])).toThrow(/no document/);
  });
});

it('preserves ordered projection reads and propagates host failures without inventing readiness', async () => {
  const { host } = fakeHost();
  const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 40 };
  const projection = { candidates: [], camera: CAMERA, hasPendingWork: true };
  const readProjection = vi
    .fn()
    .mockResolvedValueOnce(projection)
    .mockRejectedValueOnce(new Error('host lost'));
  Object.assign(host, { readProjection });
  const canvas = {} as EngineHarnessCanvas;
  const detach = attachEngineHarness(host, canvas);
  try {
    await expect(canvas.engineHarness?.readProjection?.(bounds)).resolves.toBe(projection);
    expect(readProjection).toHaveBeenCalledExactlyOnceWith(bounds);
    await expect(canvas.engineHarness?.readProjection?.(bounds)).rejects.toThrow('host lost');
    delete host.readProjection;
    await expect(canvas.engineHarness?.readProjection?.(bounds)).resolves.toBeUndefined();
  } finally {
    detach();
  }
});

it('exposes observed long animation frames by measurement cutoff and disconnects on detach', () => {
  let receive:
    ((list: { getEntries: () => { startTime: number; duration: number }[] }) => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  class Observer {
    static supportedEntryTypes = ['long-animation-frame'];
    constructor(callback: NonNullable<typeof receive>) {
      receive = callback;
    }
    observe = observe;
    disconnect = disconnect;
  }
  vi.stubGlobal('PerformanceObserver', Observer);
  const { host } = fakeHost();
  const canvas = {} as EngineHarnessCanvas;
  const detach = attachEngineHarness(host, canvas);
  try {
    expect(observe).toHaveBeenCalledExactlyOnceWith({ type: 'long-animation-frame' });
    receive?.({
      getEntries: () => [
        { startTime: 10, duration: 80 },
        { startTime: 100, duration: 70 },
      ],
    });
    expect(canvas.engineHarness?.pageLongAnimationFrames(100)).toEqual([
      { startMs: 100, durationMs: 70 },
    ]);
    expect(canvas.engineHarness?.pageLongTasks(0)).toEqual([]);
  } finally {
    detach();
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
  expect(canvas.engineHarness).toBeUndefined();
});
