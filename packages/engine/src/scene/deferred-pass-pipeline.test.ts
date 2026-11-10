import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { TransformTable } from '../gpu/transform-table.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject } from './__fixtures__/scene-objects.js';
import { CameraUniform } from './camera-uniform.js';
import { emptyFrameStats } from './frame-context.js';
import { InstanceBuffer } from './instance-buffer.js';
import {
  ROUNDED_RECT_GRADIENT_PASS,
  ROUNDED_RECT_GRADIENT_PASS_NAME,
  ROUNDED_RECT_PASS,
  ROUNDED_RECT_PASS_NAME,
} from './rounded-rect-pass.js';
import { ScenePassResources } from './scene-pass-resources.js';
import type { ScenePass } from './scene-pass.js';
import { SceneRenderer } from './scene-renderer.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

// A rounded frame's passes build their pipelines on their first record, so a board
// without one compiles none of them at engine start.

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 400, viewportHeightPx: 400 };

/**
 * The labels of the pipelines a backend has created, in order.
 *
 * @param backend - The fake backend.
 * @returns The labels.
 */
function pipelineLabels(backend: FakeGpuBackend): string[] {
  return backend.pipelines.map(({ label }) => label);
}

/**
 * A renderer of the solid and the two rounded frame background passes.
 *
 * @returns The renderer, its backend and a document to feed it.
 */
function roundedRenderer() {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, ROUNDED_RECT_PASS, ROUNDED_RECT_GRADIENT_PASS],
  });
  return { backend, renderer, document: new FakeSceneDocument() };
}

describe('deferred pass pipelines', () => {
  it('marks the rounded frame passes deferred and leaves the others eager', () => {
    expect(ROUNDED_RECT_PASS.pipelineSpec.isDeferred).toBe(true);
    expect(SOLID_RECT_PASS.pipelineSpec.isDeferred).toBeUndefined();
    expect(SDF_SHAPE_PASS.pipelineSpec.isDeferred).toBeUndefined();
  });

  it('starts with no rounded pipeline and draws a board of sharp frames without one', () => {
    const { backend, renderer, document } = roundedRenderer();
    expect(pipelineLabels(backend)).toContain(SOLID_RECT_PASS.name);
    expect(pipelineLabels(backend)).not.toContain(ROUNDED_RECT_PASS_NAME);
    expect(pipelineLabels(backend)).not.toContain(ROUNDED_RECT_GRADIENT_PASS_NAME);
    document.create(frameObject('sharp', { width: 100, height: 80 }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(pipelineLabels(backend)).not.toContain(ROUNDED_RECT_PASS_NAME);
    expect(pipelineLabels(backend)).not.toContain(ROUNDED_RECT_GRADIENT_PASS_NAME);
    renderer.destroy();
  });

  it('builds the rounded pipeline once, on the frame that first has a rounded frame', () => {
    const { backend, renderer, document } = roundedRenderer();
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const before = backend.pipelines.length;
    document.create(frameObject('round', { width: 100, height: 80, cornerRadius: 12 }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(pipelineLabels(backend).slice(before)).toEqual([ROUNDED_RECT_PASS_NAME]);
    expect(backend.calls).toContainEqual({ method: 'setPipeline', label: ROUNDED_RECT_PASS_NAME });
    expect(renderer.scene.slotsOf('round' as ObjectId, ROUNDED_RECT_PASS_NAME)).toHaveLength(1);
    document.update('round', { cornerRadius: 0 });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 32, camera: CAMERA });
    document.update('round', { cornerRadius: 20 });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 48, camera: CAMERA });
    expect(pipelineLabels(backend).filter((label) => label === ROUNDED_RECT_PASS_NAME)).toEqual([
      ROUNDED_RECT_PASS_NAME,
    ]);
    renderer.destroy();
  });

  it('builds a deferred pass and its retained-move variant on the first upload with a record', () => {
    const backend = new FakeGpuBackend();
    const pass: ScenePass = {
      ...SDF_SHAPE_PASS,
      pipelineSpec: { ...SDF_SHAPE_PASS.pipelineSpec, isDeferred: true },
    };
    const instances = new InstanceBuffer(pass.layout);
    const resources = new ScenePassResources(backend, pass, instances, new CameraUniform(backend));
    const stats = emptyFrameStats();
    expect(resources.hasPipeline).toBe(false);
    resources.upload(stats);
    expect(resources.hasPipeline).toBe(false);
    const indices = backend.createBuffer({ usage: 'vertex', byteLength: 4, label: 'indices' });
    resources.setMovePlacement({
      table: {} as TransformTable,
      indices,
      indexData: new Float32Array(1),
    });
    expect(backend.pipelines).toEqual([]);
    instances.allocate();
    resources.upload(stats);
    expect(resources.hasPipeline).toBe(true);
    expect(pipelineLabels(backend)).toEqual([pass.name, `${pass.name} retained move`]);
    resources.upload(stats);
    expect(backend.pipelines).toHaveLength(2);
    resources.setMovePlacement(undefined);
    resources.destroy();
  });
});
