import { afterEach, expect, it, vi } from 'vitest';

import { createPathScene, PATH_CAMERA, squarePath } from './__fixtures__/path-scene.js';
import { PathPreparationCache } from './path-preparation-cache.js';
import { PathRegistry } from './path-registry.js';

afterEach(() => vi.restoreAllMocks());

it('reuses partially clipped candidates while matching forced preparation across edge crossings', () => {
  const scene = createPathScene();
  scene.document.create(squarePath('clipped', 0, { x: 390 }), squarePath('hidden', 1, { x: 430 }));
  scene.renderer.frame.insertStage('before', 'preparePathMeshes', {
    name: 'bridgedCandidates',
    run(context) {
      context.drawList.splice(0, context.drawList.length, {
        passName: 'path',
        ranges: [{ start: 0, count: 4 }],
      });
    },
  });
  scene.frame();
  const owner = vi.spyOn(PathRegistry.prototype, 'ownerOf');
  const reuse = Reflect.get(PathPreparationCache.prototype, 'reuse');
  let shouldForce = false;
  vi.spyOn(PathPreparationCache.prototype, 'reuse').mockImplementation(function (
    this: PathPreparationCache,
    ...args
  ) {
    return shouldForce ? false : reuse.apply(this, args);
  });
  const reuseCandidates = Reflect.get(PathPreparationCache.prototype, 'reuseCandidates');
  vi.spyOn(PathPreparationCache.prototype, 'reuseCandidates').mockImplementation(function (
    this: PathPreparationCache,
    ...args
  ) {
    return shouldForce ? false : reuseCandidates.apply(this, args);
  });
  const commands = () =>
    scene.backend.calls.slice(
      scene.backend.calls.findIndex(({ method }) => method === 'beginRenderPass'),
    );
  for (let frame = 1; frame <= 20; frame += 1) {
    const camera = { ...PATH_CAMERA, x: frame / 10 };
    owner.mockClear();
    scene.backend.resetCalls();
    scene.frame(camera);
    expect(owner).not.toHaveBeenCalled();
    const cached = commands();
    shouldForce = true;
    scene.backend.resetCalls();
    scene.frame(camera);
    expect(commands()).toEqual(cached);
    shouldForce = false;
  }
  for (const x of [29, 30, 31, 51, 431, 452, 0]) {
    const camera = { ...PATH_CAMERA, x };
    scene.backend.resetCalls();
    scene.frame(camera);
    const cached = commands();
    shouldForce = true;
    scene.backend.resetCalls();
    scene.frame(camera);
    expect(commands()).toEqual(cached);
    shouldForce = false;
  }
  scene.renderer.destroy();
});
