import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { FrameStatsRecorder } from './frame-stats-recorder.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

function setUp(): { renderer: SceneRenderer; recorder: FrameStatsRecorder; reads: () => number } {
  const renderer = new SceneRenderer(new FakeGpuBackend());
  const document = new FakeSceneDocument();
  document.create(shapeObject('a'), shapeObject('b', { x: 20 }));
  renderer.enqueue(document.takeChanges());
  let clockReads = 0;
  const recorder = new FrameStatsRecorder(renderer.frame, () => {
    clockReads += 1;
    return clockReads;
  });
  return { renderer, recorder, reads: () => clockReads };
}

describe('FrameStatsRecorder', () => {
  it('records nothing and refuses a read until it starts', () => {
    const { renderer, recorder, reads } = setUp();
    expect(recorder.isRecording).toBe(false);
    expect(() => recorder.read()).toThrow(/startFrameStats/);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(reads()).toBe(0);
  });

  it('times every stage of the frames drawn after it starts', () => {
    const { renderer, recorder } = setUp();
    recorder.start(4);
    expect(recorder.isRecording).toBe(true);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const sample = recorder.read();
    expect(sample.frames).toBe(1);
    expect(Object.keys(sample.stages)).toEqual(renderer.frame.stageNames);
    expect(Object.values(sample.stages).every(({ p50 }) => p50 === 1)).toBe(true);
    expect(sample.p50).toMatchObject({ changedObjects: 2, drawCalls: 1 });
  });

  it('starts a new run each time, and a history of a new capacity when asked', () => {
    const { renderer, recorder } = setUp();
    recorder.start(4);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    recorder.start(4);
    expect(recorder.read().runFrames).toBe(0);
    recorder.start(2);
    for (const timeMs of [16, 32, 48]) renderer.renderFrame({ timeMs, camera: CAMERA });
    expect(recorder.read()).toMatchObject({ frames: 2, runFrames: 3 });
  });

  it('refuses a capacity that is not a positive whole number of frames', () => {
    const { recorder } = setUp();
    expect(() => {
      recorder.start(1.5);
    }).toThrow(RangeError);
    expect(recorder.isRecording).toBe(false);
  });

  it('stops by removing the timers, so frames read no clock', () => {
    const { renderer, recorder, reads } = setUp();
    recorder.start();
    recorder.stop();
    recorder.stop();
    expect(recorder.isRecording).toBe(false);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(reads()).toBe(0);
    expect(() => recorder.read()).toThrow(/startFrameStats/);
  });
});
