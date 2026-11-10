import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { WorkerPool } from '../workers/worker-pool.js';
import type * as WorkerPoolModule from '../workers/worker-pool.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import { createImagePassSupport, NO_IMAGE_ASSETS } from './image-pass-support.js';
import { IMAGE_PASS } from './image-pass.js';

vi.mock('../workers/worker-pool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkerPoolModule>();
  return {
    ...actual,
    WorkerPool: vi.fn(function (options: ConstructorParameters<typeof WorkerPool>[0]) {
      return new actual.WorkerPool(options);
    }),
  };
});

afterEach(() => vi.clearAllMocks());

describe('image pass job ownership', () => {
  it('keeps unsupported images as placeholders without allocating a worker pool', async () => {
    for (let index = 0; index < 2; index += 1) {
      const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [IMAGE_PASS] });
      const document = new FakeSceneDocument();
      document.create(imageObject());
      renderer.enqueue(document.takeChanges());
      const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
      renderer.renderFrame({ timeMs: 0, camera });
      await flushMicrotasks();
      const stats = renderer.renderFrame({ timeMs: 16, camera });
      expect(stats.placeholderImages).toBe(1);
      expect(stats.blankImages).toBe(0);
      renderer.destroy();
    }
    expect(WorkerPool).not.toHaveBeenCalled();
  });

  it('does not allocate another pool or destroy the supplied shared pool', () => {
    const jobs = new WorkerPool({ workerCount: 0, fallbackHandlers: {} });
    const terminate = vi.spyOn(jobs, 'terminate');
    const backend = new FakeGpuBackend();
    const images = createImagePassSupport(
      NO_IMAGE_ASSETS,
      jobs,
      backend.capabilities.maxTextureSize,
    );
    const renderer = new SceneRenderer(backend, { passes: [IMAGE_PASS], environment: { images } });
    renderer.destroy();
    expect(WorkerPool).toHaveBeenCalledTimes(1);
    expect(terminate).not.toHaveBeenCalled();
    jobs.terminate();
  });
});
