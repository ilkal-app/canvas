import { expect, it } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import { imageObject } from '../images/__fixtures__/image-objects.js';
import { ManualJobRunner } from '../images/__fixtures__/manual-job-runner.js';
import { createFixtureAssetSource } from '../images/fixture-asset-source.js';
import { createImagePassSupport } from '../images/image-pass-support.js';
import { IMAGE_PASS } from '../images/image-pass.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { PreviewReads } from './preview-reads.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
const REQUEST = {
  scene: { session: 'image-mount', sequence: 0 },
  camera: CAMERA,
  coverage: { minX: 0, minY: 0, maxX: 1000, maxY: 800 },
  fontSetKey: 'fixture-fonts',
};

function fixture() {
  const assets = createFixtureAssetSource(126, {
    assets: {
      photo: { naturalSize: { width: 4000, height: 3000 } },
      other: { naturalSize: { width: 4000, height: 3000 } },
    },
  });
  const backend = new FakeGpuBackend();
  const jobs = new ManualJobRunner();
  const images = createImagePassSupport(
    { ...assets, immutableContentIdentity: (id) => `fixture-v1:${id}` },
    jobs,
    backend.capabilities.maxTextureSize,
  );
  const renderer = new SceneRenderer(backend, { passes: [IMAGE_PASS], environment: { images } });
  const document = new FakeSceneDocument();
  document.create(imageObject());
  document.create(imageObject({ id: 'image-2' as ObjectId, x: 400, z: 'a1' }));
  document.create(
    imageObject({ id: 'image-3' as ObjectId, y: 400, z: 'a2', assetId: 'other' as AssetId }),
  );
  renderer.enqueue(document.takeChanges());
  const reads = new PreviewReads();
  reads.revisions.apply(REQUEST.scene);
  let timeMs = 0;
  const frame = () => renderer.renderFrame({ timeMs: (timeMs += 16), camera: CAMERA });
  const settle = async () => {
    for (let round = 0; round < 8; round += 1) {
      frame();
      await jobs.settle();
    }
  };
  return { renderer, document, reads, frame, settle };
}

it('certifies concurrent image readers after loading and deduplicates a shared asset identity', async () => {
  const scene = fixture();
  try {
    scene.frame();
    const loading = scene.reads.read(REQUEST);
    scene.reads.answer(scene.renderer, CAMERA, false);
    await expect(loading).resolves.toBeUndefined();
    await scene.settle();
    const first = scene.reads.read(REQUEST);
    const second = scene.reads.read(REQUEST);
    scene.reads.answer(scene.renderer, CAMERA, false);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a?.candidates).toEqual(['image-1', 'image-2', 'image-3']);
    expect(a?.assets).toEqual([
      { assetId: 'photo', contentVersion: 'fixture-v1:photo' },
      { assetId: 'other', contentVersion: 'fixture-v1:other' },
    ]);
    expect(a?.imagePlanKey).toContain('image-2');
  } finally {
    scene.renderer.destroy();
  }
});

it('replaces completed image evidence after an ordinary moved image frame', async () => {
  const scene = fixture();
  try {
    await scene.settle();
    const previous = scene.renderer.readPreviewResources(CAMERA, REQUEST.fontSetKey);
    expect(previous?.isCurrent()).toBe(true);
    const first = scene.reads.read(REQUEST);
    scene.reads.answer(scene.renderer, CAMERA, false);
    const before = await first;
    scene.document.update('image-2', { x: 450 });
    scene.renderer.enqueue(scene.document.takeChanges());
    const nextRequest = { ...REQUEST, scene: { ...REQUEST.scene, sequence: 1 } };
    scene.reads.revisions.apply(nextRequest.scene);
    await scene.settle();
    expect(previous?.isCurrent()).toBe(false);
    const next = scene.reads.read(nextRequest);
    scene.reads.answer(scene.renderer, CAMERA, false);
    const after = await next;
    expect(after?.scene).toEqual(nextRequest.scene);
    expect(after?.assets).toEqual(before?.assets);
    expect(after?.imagePlanKey).not.toBe(before?.imagePlanKey);
    expect(after?.frameIndex).toBeGreaterThan(before?.frameIndex ?? -1);
  } finally {
    scene.renderer.destroy();
  }
});

it('rejects every waiting reader on mount teardown without invalidating a fresh mount', async () => {
  const previous = fixture();
  const a = previous.reads.read(REQUEST);
  const b = previous.reads.read(REQUEST);
  const rejectedA = expect(a).rejects.toThrow('mount destroyed');
  const rejectedB = expect(b).rejects.toThrow('mount destroyed');
  previous.reads.reject(new Error('mount destroyed'));
  previous.renderer.destroy();
  await Promise.all([rejectedA, rejectedB]);
  const next = fixture();
  try {
    await next.settle();
    const pending = next.reads.read(REQUEST);
    next.reads.answer(next.renderer, CAMERA, false);
    await expect(pending).resolves.toMatchObject({
      scene: REQUEST.scene,
      candidates: ['image-1', 'image-2', 'image-3'],
    });
  } finally {
    next.renderer.destroy();
  }
});
