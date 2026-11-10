import { expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { PATH_CAMERA, squarePath } from './__fixtures__/path-scene.js';
import { runMeshJob } from './mesh-job.js';
import { createPooledMeshBuilder, INLINE_MESH_BUILDER } from './path-mesh-builder.js';
import { createPathPass } from './path-pass.js';
import { isPathPreviewReady } from './path-preview-readiness.js';

it('requires a completed exact built-in path frame and refuses destroyed resources', () => {
  const pass = createPathPass({ meshBuilder: INLINE_MESH_BUILDER });
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pass] });
  const document = new FakeSceneDocument();
  document.create(squarePath('square', 0));
  renderer.enqueue(document.takeChanges());
  expect(isPathPreviewReady(pass, renderer.scene.instanceBuffers.get(pass.name))).toBe(false);
  renderer.renderFrame({ timeMs: 0, camera: PATH_CAMERA });
  expect(isPathPreviewReady(pass, renderer.scene.instanceBuffers.get(pass.name))).toBe(true);
  renderer.destroy();
  expect(isPathPreviewReady(pass, renderer.scene.instanceBuffers.get(pass.name))).toBe(false);
});

it('does not recognize a custom same-name pass or a custom mesh builder', () => {
  const customBuilder = {
    build: (request: Parameters<typeof INLINE_MESH_BUILDER.build>[0]) =>
      INLINE_MESH_BUILDER.build(request),
  };
  const pass = createPathPass({ meshBuilder: customBuilder });
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pass] });
  renderer.renderFrame({ timeMs: 0, camera: PATH_CAMERA });
  expect(isPathPreviewReady(pass, renderer.scene.instanceBuffers.get(pass.name))).toBe(false);
  expect(isPathPreviewReady({ ...pass }, renderer.scene.instanceBuffers.get(pass.name))).toBe(
    false,
  );
  renderer.destroy();
});

it('keeps readiness separate when the same path pass is installed in two renderers', () => {
  const pass = createPathPass({ meshBuilder: INLINE_MESH_BUILDER });
  const first = new SceneRenderer(new FakeGpuBackend(), { passes: [pass] });
  const second = new SceneRenderer(new FakeGpuBackend(), { passes: [pass] });
  first.renderFrame({ timeMs: 0, camera: PATH_CAMERA });
  expect(isPathPreviewReady(pass, first.scene.instanceBuffers.get(pass.name))).toBe(true);
  expect(isPathPreviewReady(pass, second.scene.instanceBuffers.get(pass.name))).toBe(false);
  first.destroy();
  second.destroy();
});

it('refuses missing and nearest-bucket meshes until an exact replacement has drawn', async () => {
  const finish: (() => void)[] = [];
  const reports: { standIns: number }[] = [];
  const builder = createPooledMeshBuilder({
    submit: (kind, request) => {
      expect(kind).toBe('mesh');
      return {
        id: finish.length + 1,
        response: new Promise((resolve) => {
          finish.push(() => {
            resolve(runMeshJob(request));
          });
        }),
      };
    },
    retireWorkerOf: () => false,
  });
  const pass = createPathPass({
    meshBuilder: builder,
    onFrame: (report) => {
      reports.push(report);
    },
  });
  const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pass] });
  const document = new FakeSceneDocument();
  document.create(squarePath('square', 0));
  renderer.enqueue(document.takeChanges());
  const ready = () => isPathPreviewReady(pass, renderer.scene.instanceBuffers.get(pass.name));
  renderer.renderFrame({ timeMs: 0, camera: PATH_CAMERA });
  expect(ready()).toBe(false);
  finish.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(ready()).toBe(false);
  renderer.renderFrame({ timeMs: 1, camera: PATH_CAMERA });
  expect(ready()).toBe(true);
  const zoomed = { ...PATH_CAMERA, zoom: 4 };
  renderer.renderFrame({ timeMs: 2, camera: zoomed });
  expect(reports.at(-1)?.standIns).toBeGreaterThan(0);
  expect(ready()).toBe(false);
  finish.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(ready()).toBe(false);
  renderer.renderFrame({ timeMs: 3, camera: zoomed });
  expect(ready()).toBe(true);
  renderer.destroy();
});
