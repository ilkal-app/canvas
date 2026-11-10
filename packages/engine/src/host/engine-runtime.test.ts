import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { pathObject } from '../spatial/__fixtures__/spatial-objects.js';

import {
  FakeCanvas,
  FakeHostPlatform,
  ReadableFakeGpuBackend,
} from './__fixtures__/fake-host-platform.js';
import { recordingOverlays } from './__fixtures__/recording-overlay.js';
import type { EngineFrameReport } from './engine-host.js';
import { EngineRuntime } from './engine-runtime.js';
import type { PointerInput } from './pointer-input.js';
import { serializeChangeSet } from './serializable-change-set.js';

/**
 * The red channel of each pixel.
 *
 * @param rgba - RGBA8 pixels.
 * @returns One value per pixel.
 */
function redChannel(rgba: Uint8Array): number[] {
  return [...rgba].filter((value, index) => index % 4 === 0);
}

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 4, viewportHeightPx: 2, dpr: 1 };

function setUp(createOverlay?: ReturnType<typeof recordingOverlays>['create']): {
  platform: FakeHostPlatform;
  canvas: FakeCanvas;
  runtime: EngineRuntime;
  reports: EngineFrameReport[];
  faults: Error[];
} {
  const platform = new FakeHostPlatform();
  const canvas = new FakeCanvas(4, 2);
  const reports: EngineFrameReport[] = [];
  const faults: Error[] = [];
  const backend = new ReadableFakeGpuBackend(canvas);
  const runtime = new EngineRuntime(
    backend,
    canvas,
    platform,
    {},
    {
      onFrame: (report) => reports.push(report),
      onFault: (error) => faults.push(error),
    },
    createOverlay === undefined ? {} : { createOverlay },
  );
  platform.backends.push(backend);
  return { platform, canvas, runtime, reports, faults };
}

function pointer(type: PointerInput['type'], xPx: number): PointerInput {
  return { type, xPx, yPx: 1, buttons: 0, pointerId: 1, timestampMs: 100 + xPx };
}

function boardChange(): ReturnType<typeof serializeChangeSet> {
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b', { x: 20 }));
  return serializeChangeSet(document.takeChanges());
}

describe('EngineRuntime', () => {
  it('draws paths with its standard passes, asking for frames until their meshes are built', async () => {
    const { platform, runtime, reports } = setUp();
    const document = new FakeSceneDocument();
    // 300 paths of five segments: more than one frame's meshing budget of 1024 segments.
    for (let index = 0; index < 300; index += 1) {
      document.create(
        pathObject(
          `p${String(index)}`,
          [0, 1, 2, 3, 4, 5].map((vertex) => ({ x: vertex * 0.1, y: (vertex % 2) * 0.1 })),
        ),
      );
    }
    runtime.applyChangeSet(serializeChangeSet(document.takeChanges()));
    runtime.setCamera(CAMERA);
    // No job workers: each frame sends mesh jobs, runs them on this thread after the frame,
    // and their meshes land before the next.
    let timeMs = 0;
    while (platform.pendingFrames > 0 && timeMs < 1000) {
      timeMs += 16;
      platform.runFrame(timeMs);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(reports.length).toBeGreaterThan(2);
    expect(reports[0]?.hasPendingWork).toBe(true);
    expect(reports.at(-1)).toMatchObject({ hasPendingWork: false, isUsingJobWorkers: false });
    // The 300 opaque strokes are one run, one batched draw.
    expect(reports.at(-1)?.stats.drawCalls).toBe(1);
  });

  it('draws nothing and asks for no frame until something happens', () => {
    const { platform } = setUp();
    expect(platform.pendingFrames).toBe(0);
  });

  it('applies everything that arrived between frames in one frame', () => {
    const { platform, runtime, reports } = setUp();
    runtime.applyChangeSet(boardChange());
    runtime.setCamera(CAMERA);
    runtime.pointer(pointer('move', 1));
    expect(platform.pendingFrames).toBe(1);
    platform.runFrame(16);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ frameIndex: 0, frameTimeMs: 16, camera: CAMERA });
    expect(reports[0]?.stats).toMatchObject({ changedObjects: 2, drawCalls: 1 });
    expect(platform.pendingFrames).toBe(0);
  });

  it('draws the dot grid under the scene once shown, asking for a frame only when it changes', () => {
    const { platform, runtime, reports } = setUp();
    runtime.applyChangeSet(boardChange());
    runtime.setCamera(CAMERA);
    platform.runFrame(16);
    expect(reports[0]?.stats.drawCalls).toBe(1);
    runtime.view.setGridVisible(true);
    expect(platform.pendingFrames).toBe(1);
    platform.runFrame(32);
    expect(reports[1]?.stats.drawCalls).toBe(2);
    runtime.view.setGridVisible(true);
    expect(platform.pendingFrames).toBe(0);
  });

  it('reports the frame coalesced pointer inputs with their original timestamps', () => {
    const { platform, runtime, reports } = setUp();
    for (const xPx of [1, 2, 3]) runtime.pointer(pointer('move', xPx));
    runtime.pointer(pointer('down', 4));
    platform.runFrame(16);
    expect(reports[0]?.pointerInputs).toEqual([pointer('move', 3), pointer('down', 4)]);
    expect(reports[0]?.camera).toBeUndefined();
    expect(reports[0]?.stats.drawCalls).toBe(0);
  });

  it('keeps a camera animation drawing frame after frame until it ends', () => {
    const { platform, runtime, reports } = setUp();
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    runtime.animateCamera({ ...CAMERA, zoom: 4 }, 100);
    for (const timeMs of [16, 66, 116, 132]) platform.runFrame(timeMs);
    expect(reports.map(({ camera }) => camera?.zoom)).toEqual([1, 1, 2, 4]);
    expect(platform.pendingFrames).toBe(0);
  });

  it('stops an animation when the camera is set', () => {
    const { platform, runtime, reports } = setUp();
    runtime.setCamera(CAMERA);
    runtime.animateCamera({ ...CAMERA, zoom: 4 }, 100);
    platform.runFrame(0);
    runtime.setCamera({ ...CAMERA, x: 9 });
    platform.runFrame(16);
    expect(reports.at(-1)?.camera).toEqual({ ...CAMERA, x: 9 });
    expect(platform.pendingFrames).toBe(0);
  });

  it('jumps when asked to animate without a camera to start from', () => {
    const { platform, runtime, reports } = setUp();
    runtime.animateCamera(CAMERA, 100);
    platform.runFrame(0);
    expect(reports[0]?.camera).toEqual(CAMERA);
    expect(platform.pendingFrames).toBe(0);
  });

  it('resizes the drawing buffer and the camera viewport', () => {
    const { platform, runtime, canvas, reports } = setUp();
    runtime.setCamera(CAMERA);
    runtime.resize(40, 20, 2);
    platform.runFrame(0);
    expect([canvas.width, canvas.height]).toEqual([40, 20]);
    expect(reports[0]?.camera).toMatchObject({ viewportWidthPx: 20, viewportHeightPx: 10, dpr: 2 });
    expect(() => {
      runtime.resize(0, 20, 1);
    }).toThrow(RangeError);
  });

  it('reads the pixels of the frame it asked for, as a copy of the rectangle', async () => {
    const { platform, runtime } = setUp();
    runtime.setCamera(CAMERA);
    const pixels = runtime.readPixels({ xPx: 1, yPx: 1, widthPx: 2, heightPx: 1 });
    expect(platform.pendingFrames).toBe(1);
    platform.runFrame(0);
    const block = await pixels;
    expect(redChannel(block.rgba)).toEqual([5, 6]);
    expect(platform.backends[0]?.readCount).toBe(1);
  });

  it('rejects a read with no camera, outside the canvas, or when the read-back fails', async () => {
    const { platform, runtime } = setUp();
    const noCamera = runtime.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    platform.runFrame(0);
    await expect(noCamera).rejects.toThrow(/camera/);
    runtime.setCamera(CAMERA);
    const outside = runtime.readPixels({ xPx: 3, yPx: 0, widthPx: 2, heightPx: 1 });
    platform.runFrame(16);
    await expect(outside).rejects.toThrow(RangeError);
    const backend = platform.backends[0];
    if (backend) backend.readFailure = new Error('device lost');
    const failed = runtime.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    platform.runFrame(32);
    await expect(failed).rejects.toThrow('device lost');
  });

  it('reports a frame that throws as a fault, rejects its reads and keeps running', async () => {
    const { platform, runtime, faults, reports } = setUp();
    runtime.setCamera(CAMERA);
    runtime.renderer.frame.insertStage('before', 'draw', {
      name: 'explode',
      run: () => {
        throw new Error('stage failed');
      },
    });
    const read = runtime.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    platform.runFrame(0);
    await expect(read).rejects.toThrow('stage failed');
    expect(faults.map(({ message }) => message)).toEqual(['stage failed']);
    expect(reports).toEqual([]);
  });

  it('reports the pointer inputs of a frame that threw with the next frame', () => {
    const { platform, runtime, reports } = setUp();
    runtime.setCamera(CAMERA);
    let isFailing = true;
    runtime.renderer.frame.insertStage('before', 'draw', {
      name: 'fail-once',
      run: () => {
        if (isFailing) throw new Error('stage failed');
      },
    });
    runtime.pointer(pointer('down', 1));
    platform.runFrame(0);
    isFailing = false;
    runtime.pointer(pointer('up', 2));
    platform.runFrame(16);
    expect(reports.map(({ pointerInputs }) => pointerInputs.map(({ type }) => type))).toEqual([
      ['down', 'up'],
    ]);
  });

  it('frees the renderer and backend on destroy and ignores later calls', async () => {
    const { platform, runtime } = setUp();
    runtime.setCamera(CAMERA);
    const read = runtime.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    runtime.destroy();
    await expect(read).rejects.toThrow(/destroyed/);
    expect(platform.pendingFrames).toBe(0);
    expect(platform.backends[0]?.isDestroyed).toBe(true);
    runtime.setCamera(CAMERA);
    runtime.applyChangeSet(boardChange());
    runtime.setOverlay({ kind: 'nothing' });
    runtime.view.setGridVisible(true);
    runtime.animateCamera({ ...CAMERA, zoom: 2 }, 100);
    runtime.pointer(pointer('move', 1));
    runtime.resize(8, 4, 2);
    runtime.startFrameStats(4);
    runtime.requestFrame();
    runtime.destroy();
    expect(platform.pendingFrames).toBe(0);
    expect(() => runtime.readFrameStats()).toThrow(/destroyed/);
    await expect(runtime.readPixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 })).rejects.toThrow(
      /destroyed/,
    );
  });

  it('records no frame statistics until they are started', () => {
    const { runtime } = setUp();
    expect(() => runtime.readFrameStats()).toThrow(/startFrameStats/);
  });

  it('records CPU time per stage, the counters and GPU memory of each frame once started', () => {
    const { platform, runtime } = setUp();
    platform.clockStepMs = 1;
    runtime.startFrameStats(8);
    runtime.applyChangeSet(boardChange());
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    const sample = runtime.readFrameStats();
    expect(sample.frames).toBe(1);
    // Each clock read advances 1 ms: a stage reads it when it starts and when it ends.
    expect(Object.values(sample.stages).every(({ p50 }) => p50 === 1)).toBe(true);
    expect(Object.keys(sample.stages)).toContain('cull');
    expect(sample.p50).toMatchObject({ changedObjects: 2, drawCalls: 1 });
    expect(sample.memory.instanceBuffers.bytes).toBeGreaterThan(0);
  });

  it('starts a new run when started again, with the same timers or a new capacity', () => {
    const { platform, runtime } = setUp();
    runtime.startFrameStats(8);
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    runtime.startFrameStats(8);
    expect(runtime.readFrameStats().runFrames).toBe(0);
    runtime.requestFrame();
    platform.runFrame(16);
    expect(runtime.readFrameStats().runFrames).toBe(1);
    runtime.startFrameStats(2);
    for (const timeMs of [32, 48, 64]) {
      runtime.requestFrame();
      platform.runFrame(timeMs);
    }
    expect(runtime.readFrameStats()).toMatchObject({ frames: 2, runFrames: 3 });
  });

  it('refuses a history capacity that is not a positive whole number of frames', () => {
    const { runtime } = setUp();
    expect(() => {
      runtime.startFrameStats(0);
    }).toThrow(RangeError);
  });

  it('applies the change sets that arrived in the frame, as the timed applyChanges stage', () => {
    const { platform, runtime } = setUp();
    platform.clockStepMs = 1;
    runtime.startFrameStats(8);
    runtime.applyChangeSet(boardChange());
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    const { stages } = runtime.readFrameStats();
    expect(Object.keys(stages)[0]).toBe('applyChanges');
    expect(stages.applyChanges).toEqual({ p50: 1, p95: 1 });
  });

  it('reports a malformed change set as a fault and draws the rest', () => {
    const { platform, runtime, reports, faults } = setUp();
    runtime.applyChangeSet({ created: [7], updated: [], deleted: [] } as never);
    runtime.applyChangeSet(boardChange());
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    expect(faults.map(({ name }) => name)).toEqual(['TypeError']);
    expect(reports[0]?.stats.changedObjects).toBe(2);
  });

  it('draws the overlay layer after the scene with the latest model, timed with the frame', () => {
    const overlays = recordingOverlays();
    const { platform, runtime, faults } = setUp(overlays.create);
    const [layer] = overlays.layers;
    expect(layer?.backend).toBe(platform.backends[0]);
    runtime.startFrameStats(8);
    runtime.setOverlay({ label: 'old' });
    runtime.setOverlay({ label: 'selection' });
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    runtime.setOverlay({ nothing: true });
    platform.runFrame(16);
    expect(layer?.drawn).toEqual(['selection', 'selection']);
    expect(faults.map(({ name }) => name)).toEqual(['TypeError']);
    expect(Object.keys(runtime.readFrameStats().stages)).toContain('recordingOverlay');
    runtime.destroy();
    expect(layer?.isDestroyed).toBe(true);
  });

  it('reports each frame with the drawing buffer it drew into', () => {
    const { platform, runtime, reports } = setUp();
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    runtime.resize(8, 6, 2);
    platform.runFrame(16);
    expect(reports.map(({ drawingBuffer }) => drawingBuffer)).toEqual([
      { widthPx: 4, heightPx: 2 },
      { widthPx: 8, heightPx: 6 },
    ]);
  });

  it('stops recording frame statistics, leaving the frame untimed', () => {
    const { platform, runtime } = setUp();
    runtime.startFrameStats(8);
    runtime.stopFrameStats();
    runtime.stopFrameStats();
    expect(() => runtime.readFrameStats()).toThrow(/startFrameStats/);
    platform.clockStepMs = 1;
    runtime.setCamera(CAMERA);
    platform.runFrame(0);
    expect(platform.clockMs).toBe(0);
  });
});
