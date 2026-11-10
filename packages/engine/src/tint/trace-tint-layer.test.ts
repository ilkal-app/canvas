import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { RecordingOverlay } from '../host/__fixtures__/recording-overlay.js';
import { layerOverlays, overlayLayerModel } from '../host/layered-overlay.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { createTraceTintLayer, TRACE_TINT_STAGE_NAME, TraceTintLayer } from './trace-tint-layer.js';
import { EMPTY_TRACE_TINT, type TraceTintModel } from './trace-tint-model.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

const MODEL: TraceTintModel = {
  sheets: [{ bounds: { minX: 40, minY: 80, maxX: 200, maxY: 160 }, color: [0.6, 0.7, 0.8, 1] }],
};

function setUp() {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
  const tint = new TraceTintLayer(backend);
  tint.install(renderer.frame);
  const frame = (camera: Camera = CAMERA): void => {
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 0, camera });
  };
  const tintWrites = (): string[] =>
    backend
      .writes()
      .map(({ label }) => label)
      .filter((label) => label.startsWith('trace-tint'));
  return { backend, renderer, tint, frame, tintWrites };
}

describe('TraceTintLayer', () => {
  it('runs right after the scene is drawn', () => {
    const { renderer } = setUp();
    const names = renderer.frame.stageNames;
    expect(names.indexOf(TRACE_TINT_STAGE_NAME)).toBe(names.indexOf('draw') + 1);
  });

  it('writes and draws nothing with no sheet open, whatever the camera does', () => {
    const { backend, tint, frame, tintWrites } = setUp();
    frame();
    const draws = backend.count('draw');
    frame({ ...CAMERA, x: 50, zoom: 3 });
    expect(tintWrites()).toEqual([]);
    expect(backend.count('draw')).toBe(draws);
    expect(tint.rectCount).toBe(0);
  });

  it('draws a sheet as five rectangles in one instanced draw', () => {
    const { backend, tint, frame } = setUp();
    frame();
    const sceneDraws = backend.draws().length;
    tint.setModel(MODEL);
    frame();
    expect(tint.rectCount).toBe(5);
    const draws = backend.draws();
    expect(draws).toHaveLength(sceneDraws + 1);
    expect(draws.at(-1)).toMatchObject({ vertexCount: 6, instanceCount: 5 });
  });

  it('uploads no instances when only the camera pans, nor on a frame where nothing changed', () => {
    const { tint, frame, tintWrites } = setUp();
    tint.setModel(MODEL);
    frame();
    frame();
    expect(tintWrites()).toEqual([]);
    // A pan writes only the camera uniforms (the scene's and the tint's, both `camera`).
    frame({ ...CAMERA, x: 25, y: -10 });
    expect(tintWrites()).toEqual([]);
  });

  it('rebuilds on a zoom, and on a new model, and stops drawing when the sheets close', () => {
    const { tint, frame, tintWrites } = setUp();
    tint.setModel(MODEL);
    frame();
    frame({ ...CAMERA, zoom: 2 });
    expect(tintWrites()).toContain('trace-tint instances');
    tint.setModel({ sheets: [...MODEL.sheets, ...MODEL.sheets] });
    frame({ ...CAMERA, zoom: 2 });
    expect(tint.rectCount).toBe(10);
    expect(tintWrites()).toContain('trace-tint instances');
    tint.setModel(EMPTY_TRACE_TINT);
    frame({ ...CAMERA, zoom: 2 });
    expect(tint.rectCount).toBe(0);
  });
});

describe('createTraceTintLayer', () => {
  it('refuses a model that is not a trace tint model', () => {
    const layer = createTraceTintLayer(new FakeGpuBackend());
    expect(layer.setModel({ label: 'x' })).toBe(false);
    expect(layer.setModel(MODEL)).toBe(true);
    layer.destroy();
  });
});

describe('layerOverlays', () => {
  it('routes wrapped models to their layer and the rest to the base, which draws on top', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { clearColor: [0, 0, 0, 0] });
    let base: RecordingOverlay | undefined;
    const create = layerOverlays((gpu) => (base = new RecordingOverlay(gpu)), {
      tint: createTraceTintLayer,
    });
    const layer = create(backend);
    layer.install(renderer.frame);
    const names = renderer.frame.stageNames;
    expect(names.indexOf(TRACE_TINT_STAGE_NAME)).toBe(names.indexOf('draw') + 1);
    expect(names.indexOf('recordingOverlay')).toBe(names.indexOf('draw') + 2);

    expect(layer.setModel({ label: 'selection' })).toBe(true);
    expect(layer.setModel(overlayLayerModel('tint', MODEL))).toBe(true);
    expect(layer.setModel(overlayLayerModel('tint', { label: 'selection' }))).toBe(false);
    expect(layer.setModel(overlayLayerModel('nobody', MODEL))).toBe(false);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(base?.drawn).toEqual(['selection']);
    layer.destroy();
    expect(base?.isDestroyed).toBe(true);
  });
});
