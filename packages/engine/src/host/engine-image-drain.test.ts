import { describe, expect, it, vi } from 'vitest';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { imageObject } from '../images/__fixtures__/image-objects.js';
import { flushMicrotasks } from '../images/__fixtures__/manual-job-runner.js';
import { cameraAt } from '../images/__fixtures__/texture-manager-harness.js';
import { createFixtureAssetSource } from '../images/fixture-asset-source.js';
import { createImagePassSupport } from '../images/image-pass-support.js';
import { IMAGE_PASS } from '../images/image-pass.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { createDecodeJobHandler } from '../workers/decode-job.js';

import { EngineFoundation } from './engine-foundation.js';

describe('image job draining', () => {
  it.each([false, true])('leaves draining to the owner (standalone: %s)', async (isStandalone) => {
    const backend = new FakeGpuBackend();
    const assets = createFixtureAssetSource(1);
    const foundation = new EngineFoundation(
      backend,
      {},
      { images: { assets, decodeFallback: createDecodeJobHandler() } },
      new MemoryLedger(),
    );
    const { pool } = foundation.jobs;
    const images = isStandalone
      ? createImagePassSupport(assets, pool, backend.capabilities.maxTextureSize)
      : foundation.environment.images;
    if (images === undefined) throw new Error('Expected image support');
    const drain = vi.spyOn(pool, 'drainMainThread');
    const renderer = new SceneRenderer(backend, {
      passes: [IMAGE_PASS],
      environment: { ...foundation.environment, images },
    });
    const document = new FakeSceneDocument();
    document.create(imageObject());
    renderer.enqueue(document.takeChanges());
    let last;
    try {
      for (let frame = 0; frame < 8; frame += 1) {
        drain.mockClear();
        last = renderer.renderFrame({ timeMs: frame * 16, camera: cameraAt(1) });
        if (!isStandalone) {
          expect(drain).not.toHaveBeenCalled();
          foundation.jobs.runQueued(() => 0);
        }
        await flushMicrotasks();
      }
      expect(last?.visibleImages).toBe(1);
      expect(last?.placeholderImages).toBe(0);
      expect(last?.blankImages).toBe(0);
    } finally {
      renderer.destroy();
      if (isStandalone) images.catalogue.destroy();
      foundation.destroy();
    }
  });
});
