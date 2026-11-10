import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject } from '../__fixtures__/scene-objects.js';
import type { FrameContext } from '../frame-context.js';
import { SceneRenderer } from '../scene-renderer.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

import { LAYER_COMPOSITE_PASS } from './layer-composite-pass.js';
import { createLayersStage, LAYERS_STAGE_NAME } from './layers-stage.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

describe('the layers stage', () => {
  it('does nothing in a renderer without the layer composite pass', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { passes: [SOLID_RECT_PASS] });
    expect(renderer.frame.stageNames).toContain(LAYERS_STAGE_NAME);
    const document = new FakeSceneDocument();
    document.create(frameObject('f', { opacity: 0.5 }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(backend.targets).toHaveLength(0);
    expect(createLayersStage([]).name).toBe(LAYERS_STAGE_NAME);
  });

  it('skips the window of a layer with nowhere to land, leaving the camera alone', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [SOLID_RECT_PASS, LAYER_COMPOSITE_PASS],
    });
    const document = new FakeSceneDocument();
    // Culled in (the culler pads the viewport) but past the canvas's last pixel.
    document.create(frameObject('f', { x: 402, y: 10, width: 100, height: 100, opacity: 0.5 }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.calls.filter((call) => call.method === 'beginRenderPass')).toHaveLength(1);
    expect(backend.writes().filter(({ label }) => label === 'camera')).toHaveLength(0);
  });

  it('refuses a layer entry naming no pass', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [SOLID_RECT_PASS, LAYER_COMPOSITE_PASS],
    });
    const document = new FakeSceneDocument();
    document.create(frameObject('f', { opacity: 0.5 }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    renderer.frame.insertStage('before', LAYERS_STAGE_NAME, {
      name: 'corrupt',
      run(context: FrameContext) {
        context.drawList.unshift({ passName: 'nothing', ranges: [], layer: 'f' as ObjectId });
      },
    });
    expect(() => renderer.renderFrame({ timeMs: 16, camera: CAMERA })).toThrow(/no scene pass/);
  });
});
