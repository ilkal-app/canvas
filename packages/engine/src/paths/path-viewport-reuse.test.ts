import { afterEach, expect, it, vi } from 'vitest';

import {
  createPathScene,
  PATH_CAMERA,
  squarePath,
  type PathSceneOptions,
} from './__fixtures__/path-scene.js';
import { MeshCache } from './mesh-cache.js';
import type { MeshJobResponse } from './mesh-job-payload.js';
import { INLINE_MESH_BUILDER } from './path-mesh-builder.js';

// Hold the culler's padded candidates fixed while the actual viewport crosses a path.
function sceneWithCandidates(options: PathSceneOptions = {}) {
  const scene = createPathScene(options);
  for (let index = 0; index < 100; index += 1) {
    scene.document.create(squarePath(`p${String(index)}`, index, { x: 40 }));
  }
  scene.document.create(squarePath('entering', 100, { x: 420 }));
  scene.renderer.frame.insertStage('before', 'preparePathMeshes', {
    name: 'fixedCandidates',
    run(context) {
      context.drawList.splice(0, context.drawList.length, {
        passName: 'path',
        ranges: [{ start: 0, count: 202 }],
      });
    },
  });
  return scene;
}

afterEach(() => vi.restoreAllMocks());

it('resolves only the entering mesh when a pan changes visibility inside unchanged ranges', () => {
  const scene = sceneWithCandidates();
  scene.frame();
  expect(scene.reports.at(-1)?.pathsDrawn).toBe(100);
  const lookup = vi.spyOn(MeshCache.prototype, 'get');
  scene.frame({ ...PATH_CAMERA, x: 30 });
  expect(scene.reports.at(-1)).toMatchObject({ pathsDrawn: 101, meshesBuilt: 1 });
  expect(lookup).toHaveBeenCalledTimes(1);
  lookup.mockClear();
  scene.frame({ ...PATH_CAMERA, x: 31 });
  expect(scene.reports.at(-1)?.pathsDrawn).toBe(101);
  expect(lookup).not.toHaveBeenCalled();
  scene.renderer.destroy();
});

it('unpins departing meshes while keeping the remaining visible meshes alive over budget', () => {
  const scene = sceneWithCandidates({ meshByteBudget: 1, meshPageBytes: 0 });
  scene.frame();
  scene.frame({ ...PATH_CAMERA, x: 30 });
  const buffers = scene.backend.buffers.filter(({ label }) => label === 'path mesh');
  expect(buffers).toHaveLength(101);
  scene.frame({ ...PATH_CAMERA, x: 100 });
  expect(scene.reports.at(-1)?.pathsDrawn).toBe(1);
  expect(buffers.filter(({ isDestroyed }) => !isDestroyed)).toHaveLength(1);
  scene.frame({ ...PATH_CAMERA, x: 1000 });
  expect(scene.reports.at(-1)?.pathsDrawn).toBe(0);
  expect(buffers.every(({ isDestroyed }) => isDestroyed)).toBe(true);
  scene.renderer.destroy();
});

it('keeps preparing while an entering path waits for its mesh and draws it when it lands', async () => {
  let finish: (() => void) | undefined;
  const scene = sceneWithCandidates({
    meshBuilder: {
      build(request) {
        const response = INLINE_MESH_BUILDER.build(request);
        if (request.objectId !== 'entering') return response;
        return new Promise<MeshJobResponse>((resolve) => {
          finish = () => {
            void Promise.resolve(response).then(resolve);
          };
        });
      },
    },
  });
  scene.frame();
  scene.frame({ ...PATH_CAMERA, x: 30 });
  expect(scene.renderer.hasPendingWork()).toBe(true);
  expect(scene.reports.at(-1)?.pathsDrawn).toBe(100);
  scene.frame({ ...PATH_CAMERA, x: 31 });
  expect(scene.renderer.hasPendingWork()).toBe(true);
  finish?.();
  await vi.waitFor(() => {
    expect(scene.renderer.hasPendingWork()).toBe(false);
  });
  scene.frame({ ...PATH_CAMERA, x: 31 });
  expect(scene.reports.at(-1)?.pathsDrawn).toBe(101);
  scene.renderer.destroy();
});
