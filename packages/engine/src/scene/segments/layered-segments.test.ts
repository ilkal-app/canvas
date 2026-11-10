import { describe, expect, it } from 'vitest';

import type { Camera } from '../../camera/camera.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../__fixtures__/scene-objects.js';
import { LAYER_COMPOSITE_PASS } from '../layers/layer-composite-pass.js';
import { AllVisibleCuller } from '../scene-culler.js';
import type { SceneRendererOptions } from '../scene-renderer-options.js';
import { SceneRenderer } from '../scene-renderer.js';
import { Scene } from '../scene.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

import { layerSlotsOf } from './layered-segments.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

function setUp(options: SceneRendererOptions = {}) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, LAYER_COMPOSITE_PASS, SDF_SHAPE_PASS],
    ...options,
  });
  const document = new FakeSceneDocument();
  let time = 0;
  const frame = (): void => {
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    renderer.renderFrame({ timeMs: (time += 16), camera: CAMERA });
  };
  const lastTarget = () => backend.targets.at(-1);
  const canvasShapes = (): number => {
    let isCanvas = false;
    let pipeline = '';
    let count = 0;
    for (const call of backend.calls) {
      if (call.method === 'beginRenderPass') isCanvas = call.target === undefined;
      if (call.method === 'setPipeline') pipeline = call.label;
      if (call.method === 'draw' && isCanvas && pipeline.startsWith('sdf-shape')) count += 1;
    }
    return count;
  };
  return { backend, document, frame, lastTarget, canvasShapes };
}

describe('layered z-order segments', () => {
  it('finds no layers in a scene without the layer composite pass', () => {
    expect(layerSlotsOf(new Scene([SOLID_RECT_PASS])).size).toBe(0);
  });

  it('re-measures a kept layer when its member moves', () => {
    const { document, frame, lastTarget } = setUp();
    document.create(
      groupObject('g', { opacity: 0.5 }),
      shapeObject('s', { parentId: 'g', x: 10, y: 10, width: 80, height: 80 }),
    );
    frame();
    // 82 px in 64 px buckets.
    expect(lastTarget()).toMatchObject({ width: 128, height: 128 });
    document.update('s', { width: 160 });
    frame();
    expect(lastTarget()).toMatchObject({ width: 192, height: 128 });
  });

  it('draws a layer’s content on the canvas again once it is opaque, and hides it at 0', () => {
    const { document, frame, canvasShapes, backend } = setUp();
    document.create(
      groupObject('g', { opacity: 0.5 }),
      shapeObject('s', { parentId: 'g', width: 100, height: 100 }),
    );
    frame();
    expect(canvasShapes()).toBe(0);
    document.update('g', { opacity: 1 });
    frame();
    expect(canvasShapes()).toBe(1);
    document.update('g', { opacity: 0 });
    frame();
    expect(canvasShapes()).toBe(0);
    expect(backend.calls.some((call) => call.method === 'beginRenderPass' && call.target)).toBe(
      false,
    );
    document.update('g', { opacity: 0.5 });
    frame();
    expect(backend.calls.some((call) => call.method === 'beginRenderPass' && call.target)).toBe(
      true,
    );
  });

  it('gives a layer the whole canvas without a spatial index to measure it', () => {
    const { document, frame, lastTarget } = setUp({ culler: new AllVisibleCuller() });
    document.create(frameObject('f', { width: 100, height: 100, opacity: 0.5 }));
    frame();
    // The canvas's 400 × 300 in 64 px buckets.
    expect(lastTarget()).toMatchObject({ width: 448, height: 320 });
    document.update('f', { x: 50 });
    frame();
    expect(lastTarget()).toMatchObject({ width: 448, height: 320 });
  });

  it('re-plans a layered plan merged by boxes when something moves', () => {
    const { document, frame, lastTarget } = setUp();
    document.create(
      frameObject('back', { x: 200, y: 200, width: 20, height: 20 }),
      frameObject('f', { x: 10, y: 10, width: 100, height: 100, opacity: 0.5 }),
      frameObject('front', { x: 300, y: 10, width: 20, height: 20 }),
    );
    frame();
    document.update('front', { x: 310 });
    frame();
    document.update('f', { x: 20 });
    frame();
    expect(lastTarget()).toMatchObject({ width: 128, height: 128 });
  });
});
