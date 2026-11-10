import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import type { GpuBackend, GpuPassTiming } from '../gpu/gpu-backend.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../scene/__fixtures__/filled-rect-pass.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { BUILT_IN_STAGE_NAMES } from '../scene/built-in-stages.js';
import { CAMERA_UNIFORM_BYTE_LENGTH } from '../scene/camera-uniform.js';
import type { FrameContext, FrameStage } from '../scene/frame-context.js';
import { Frame } from '../scene/frame.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { installStageTimers } from './install-stage-timers.js';
import { StageTimers } from './stage-timers.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

// A clock that moves 1 ms on every read, and counts its reads.
function steppingClock(): { read: () => number; reads: () => number } {
  let readCount = 0;
  return {
    read: () => {
      readCount += 1;
      return readCount;
    },
    reads: () => readCount,
  };
}

// The stage objects a frame holds now, read through `wrapStage` without changing them.
function stagesOf(frame: Frame): FrameStage[] {
  return frame.stageNames.map((name) => {
    let current: FrameStage | undefined;
    frame.wrapStage(name, (stage) => {
      current = stage;
      return stage;
    });
    if (!current) throw new Error(`No stage ${name}`);
    return current;
  });
}

function rendererWithShapes(count: number): SceneRenderer {
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [FILLED_RECT_PASS] });
  const document = new FakeSceneDocument();
  for (let index = 0; index < count; index += 1) document.create(shapeObject(`s${String(index)}`));
  renderer.enqueue(document.takeChanges());
  return renderer;
}

describe('installStageTimers', () => {
  it('times every stage of a real frame and records its counters', () => {
    const clock = steppingClock();
    const timers = new StageTimers({ clock: clock.read });
    const renderer = rendererWithShapes(3);
    const installation = installStageTimers(renderer.frame, timers);
    expect(installation.stageNames).toEqual(BUILT_IN_STAGE_NAMES);
    const stats = renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    const sample = timers.history.newest;
    expect(timers.history.stageNames).toEqual(BUILT_IN_STAGE_NAMES);
    // The stepping clock moves 1 ms per read: each stage takes 1 ms, and the frame spans every
    // read from the first stage's start to the last stage's end.
    expect(sample?.stageMs).toEqual(BUILT_IN_STAGE_NAMES.map(() => 1));
    expect(sample?.cpuMs).toBe(2 * BUILT_IN_STAGE_NAMES.length - 1);
    expect(sample).toMatchObject({
      frameIndex: 0,
      timeMs: 16,
      drawCalls: stats.drawCalls,
      uploadedBytes: stats.uploadedBytes,
      bufferWrites: stats.bufferWrites,
      changedObjects: 3,
      visibleRecords: 3,
    });
    expect(timers.ledger.bytesOf('instanceBuffers')).toBe(
      renderer.scene.instanceBufferOf('solid-rect').byteLength,
    );
  });

  it('keeps the stages running in order and their names in place', () => {
    const renderer = rendererWithShapes(1);
    const before = renderer.frame.stageNames;
    installStageTimers(renderer.frame, new StageTimers({ clock: steppingClock().read }));
    expect(renderer.frame.stageNames).toEqual(before);
    const stats = renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(stats.drawCalls).toBe(1);
  });

  it('times a stage that throws and records no frame for it', () => {
    const clock = steppingClock();
    const timers = new StageTimers({ clock: clock.read });
    const renderer = rendererWithShapes(1);
    let shouldThrow = true;
    renderer.frame.insertStage('after', 'cull', {
      name: 'segments',
      run: () => {
        if (shouldThrow) throw new Error('segment overflow');
      },
    });
    installStageTimers(renderer.frame, timers);
    expect(() => renderer.renderFrame({ timeMs: 0, camera: CAMERA })).toThrow('segment overflow');
    expect(timers.history.size).toBe(0);
    shouldThrow = false;
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(timers.history.size).toBe(1);
    expect(timers.history.newest?.timeMs).toBe(16);
  });

  it('uninstalls to the original stages, so a disabled timer costs nothing', () => {
    const clock = steppingClock();
    const timers = new StageTimers({ clock: clock.read });
    const renderer = rendererWithShapes(2);
    const originals = stagesOf(renderer.frame);
    const installation = installStageTimers(renderer.frame, timers);
    expect(installation.isInstalled).toBe(true);
    expect(stagesOf(renderer.frame).some((stage, index) => stage === originals[index])).toBe(false);
    installation.uninstall();
    expect(installation.isInstalled).toBe(false);
    expect(stagesOf(renderer.frame)).toEqual(originals);
    stagesOf(renderer.frame).forEach((stage, index) => {
      expect(stage).toBe(originals[index]);
    });
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(clock.reads()).toBe(0);
    expect(timers.history.size).toBe(0);
    installation.uninstall();
    expect(stagesOf(renderer.frame)).toEqual(originals);
  });

  it('reads no clock in a frame that was never given timers', () => {
    const clock = steppingClock();
    const timers = new StageTimers({ clock: clock.read });
    const renderer = rendererWithShapes(2);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(clock.reads()).toBe(0);
    expect(timers.history.size).toBe(0);
  });

  it('refuses to uninstall from under a wrapper added after it, changing nothing', () => {
    const timers = new StageTimers({ clock: steppingClock().read });
    const renderer = rendererWithShapes(1);
    const installation = installStageTimers(renderer.frame, timers);
    renderer.frame.wrapStage('draw', (inner) => ({
      name: inner.name,
      run: (context) => {
        inner.run(context);
      },
    }));
    const wrapped = stagesOf(renderer.frame);
    expect(() => {
      installation.uninstall();
    }).toThrow(/draw/);
    expect(installation.isInstalled).toBe(true);
    expect(stagesOf(renderer.frame)).toEqual(wrapped);
  });

  it('refuses to install twice on the same frame, changing nothing', () => {
    const renderer = rendererWithShapes(1);
    installStageTimers(renderer.frame, new StageTimers({ clock: steppingClock().read }));
    const installed = stagesOf(renderer.frame);
    expect(() =>
      installStageTimers(renderer.frame, new StageTimers({ clock: steppingClock().read })),
    ).toThrow(/already timed/);
    stagesOf(renderer.frame).forEach((stage, index) => {
      expect(stage).toBe(installed[index]);
    });
  });

  it('can be installed again after uninstalling', () => {
    const clock = steppingClock();
    const timers = new StageTimers({ clock: clock.read });
    const renderer = rendererWithShapes(1);
    installStageTimers(renderer.frame, timers).uninstall();
    installStageTimers(renderer.frame, timers);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(timers.history.size).toBe(1);
  });

  it('attributes no stale backlog to the first frame after re-installing', async () => {
    // A backend that, like the real ones, keeps labelled passes until someone collects them.
    let uncollected: GpuPassTiming[] = [];
    const backend = {
      capabilities: { hasTimestampQuery: true },
      collectPassTimings: () => {
        const timings = uncollected;
        uncollected = [];
        return Promise.resolve(timings);
      },
    } as unknown as GpuBackend;
    const frame = new Frame([
      {
        name: 'submit',
        run: () => {
          uncollected.push({ label: 'scene', durationMs: 2 });
        },
      },
    ]);
    const timers = new StageTimers({ clock: steppingClock().read });
    let frameIndex = 0;
    const renderFrame = async (): Promise<void> => {
      frame.run({
        frameIndex,
        timeMs: frameIndex * 16,
        backend,
        timers: { stageStarted: () => undefined, stageEnded: () => undefined },
        stats: { changedObjects: 0, bufferWrites: 0, uploadedBytes: 0, drawCalls: 1 },
        drawList: [],
        layers: [],
        passes: [],
        cameraUniform: { buffer: { byteLength: CAMERA_UNIFORM_BYTE_LENGTH } },
      } as unknown as FrameContext);
      frameIndex += 1;
      await Promise.resolve();
      await Promise.resolve();
    };

    const installation = installStageTimers(frame, timers);
    await renderFrame();
    installation.uninstall();
    for (let index = 0; index < 4; index += 1) await renderFrame();
    installStageTimers(frame, timers);
    await renderFrame();
    await renderFrame();

    const gpuMs = [0, 1, 2].map((index) => timers.history.at(index).passGpuMs[0]);
    expect(timers.history.at(1).frameIndex).toBe(5);
    expect(gpuMs[0]).toBe(2);
    expect(gpuMs[1] ?? Number.NaN).toBeNaN();
    expect(gpuMs[2]).toBe(2);
  });
});
