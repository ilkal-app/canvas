import { expect, it, vi } from 'vitest';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { ProjectionReads } from './scene-projection.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 100, viewportHeightPx: 100, dpr: 1 };
const BOUNDS = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

it('keeps query bounds owned until the renderer reaches the frame barrier', async () => {
  const reads = new ProjectionReads();
  const bounds = { ...BOUNDS };
  const pending = reads.read(bounds);
  bounds.maxX = -1;
  const renderer = new SceneRenderer(new FakeGpuBackend());
  const document = new FakeSceneDocument();
  const object = shapeObject('visible', { x: 50 });
  document.create(object);
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  reads.answer(renderer, CAMERA);
  await expect(pending).resolves.toEqual({
    candidates: [object.id],
    camera: CAMERA,
    hasPendingWork: false,
  });
});

it('settles without a projection when no camera has drawn', async () => {
  const reads = new ProjectionReads();
  const pending = reads.read(BOUNDS);
  reads.answer(new SceneRenderer(new FakeGpuBackend()), undefined);
  await expect(pending).resolves.toBeUndefined();
});

it('rejects queued queries on a frame or lifecycle failure', async () => {
  const reads = new ProjectionReads();
  const pending = reads.read(BOUNDS);
  const assertion = expect(pending).rejects.toThrow('destroyed');
  reads.reject(new Error('destroyed'));
  await assertion;
});

it('refuses nonfinite or inverted coverage', async () => {
  const reads = new ProjectionReads();
  await expect(reads.read({ ...BOUNDS, minX: Number.NaN })).rejects.toThrow('finite');
  await expect(reads.read({ ...BOUNDS, maxY: -1 })).rejects.toThrow('ordered');
});

it('a failed query rejects itself without stranding other frame reads', async () => {
  const reads = new ProjectionReads();
  const first = reads.read(BOUNDS);
  const second = reads.read(BOUNDS);
  const renderer = new SceneRenderer(new FakeGpuBackend());
  vi.spyOn(renderer, 'projectionCandidates').mockImplementationOnce(() => {
    throw new Error('query failed');
  });
  const rejected = expect(first).rejects.toThrow('query failed');
  reads.answer(renderer, CAMERA);
  await rejected;
  await expect(second).resolves.toMatchObject({ candidates: [] });
});
