import { afterEach, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';
import { stickyObject } from '../../spatial/__fixtures__/spatial-objects.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene-renderer.js';
import { createDrawn } from '../segments/__fixtures__/standard-draw-order.js';
import { SOLID_RECT_PASS } from '../solid-rect-pass.js';

import { LAYER_COMPOSITE_PASS_NAME } from './layer-composite-pass-name.js';
import { LAYER_COMPOSITE_PASS } from './layer-composite-pass.js';

// Review: the layer composite builds nothing at engine start (as's deferred
// passes), and layer form needs the z-order segments that plan layers.

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

const pools: WorkerPool[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

/**
 * What the backend made for layers: composite pipelines, targets and buffers other than the
 * pass's instance buffer.
 *
 * @param backend - The fake backend.
 * @returns The counts.
 */
function layerResources(backend: FakeGpuBackend) {
  return {
    pipelines: backend.pipelines.filter(({ label }) => label === LAYER_COMPOSITE_PASS_NAME).length,
    targets: backend.targets.length,
    buffers: backend.buffers.filter(
      ({ label }) =>
        label.startsWith(LAYER_COMPOSITE_PASS_NAME) &&
        label !== `${LAYER_COMPOSITE_PASS_NAME} instances`,
    ).length,
  };
}

describe('layer compositing at engine start', () => {
  it('is a deferred pass whose pipeline waits for the first layer', () => {
    expect(LAYER_COMPOSITE_PASS.pipelineSpec.isDeferred).toBe(true);
    const drawn = createDrawn(pools);
    expect(layerResources(drawn.backend)).toEqual({ pipelines: 0, targets: 0, buffers: 0 });
    drawn.document.create(
      frameObject('frame', { name: 'Frame' }),
      shapeObject('shape', { x: 120, opacity: 0.5 }),
    );
    drawn.renderer.enqueue(drawn.document.takeChanges());
    drawn.renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    drawn.renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(layerResources(drawn.backend)).toEqual({ pipelines: 0, targets: 0, buffers: 0 });
    drawn.document.create(
      groupObject('group', { opacity: 0.5 }),
      // At least 64 px: a smaller layer draws in the multiply form.
      shapeObject('child', { parentId: 'group', width: 100, height: 100 }),
    );
    drawn.renderer.enqueue(drawn.document.takeChanges());
    drawn.renderer.renderFrame({ timeMs: 32, camera: CAMERA });
    drawn.renderer.renderFrame({ timeMs: 48, camera: CAMERA });
    expect(layerResources(drawn.backend)).toEqual({ pipelines: 1, targets: 1, buffers: 3 });
  });

  it('multiplies every opacity, with no layer, when the renderer does not z-order', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [SOLID_RECT_PASS, LAYER_COMPOSITE_PASS, SDF_SHAPE_PASS],
      isZOrdered: false,
    });
    const document = new FakeSceneDocument();
    document.create(
      groupObject('group', { opacity: 0.5 }),
      shapeObject('child', { parentId: 'group', width: 20, height: 20 }),
      frameObject('frame', { x: 50, opacity: 0.5 }),
      stickyObject('note', { x: 200, opacity: 0.5 }),
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const transparency = (id: string, pass: string): number[] => {
      const buffer = renderer.scene.instanceBufferOf(pass);
      const { floatsPerRecord, opacityFloat = -1 } = buffer.layout;
      return renderer.scene
        .slotsOf(id as ObjectId, pass)
        .map((slot) => buffer.data[slot * floatsPerRecord + opacityFloat] ?? -1);
    };
    expect(transparency('child', SDF_SHAPE_PASS.name)).toEqual([0.5]);
    expect(transparency('frame', SOLID_RECT_PASS.name)).toEqual([0.5]);
    expect(transparency('note', SDF_SHAPE_PASS.name)).toEqual([0.5, 0.5]);
    expect(backend.calls.some((call) => call.method === 'beginRenderPass' && call.target)).toBe(
      false,
    );
    expect(layerResources(backend)).toEqual({ pipelines: 0, targets: 0, buffers: 0 });
  });
});
