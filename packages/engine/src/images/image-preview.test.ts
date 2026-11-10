import { expect, it, vi } from 'vitest';

import type { ImageObject } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { ManualJobRunner } from './__fixtures__/manual-job-runner.js';
import type { AssetSource } from './asset-source.js';
import { createFixtureAssetSource, type FixtureAssetOptions } from './fixture-asset-source.js';
import { createImagePassSupport } from './image-pass-support.js';
import { IMAGE_PASS } from './image-pass.js';
import {
  imagePreviewOf,
  isImagePreviewEvidenceCurrent,
  readImagePreviewEvidence,
} from './image-preview-registry.js';
import type { ImagePreviewTracker } from './image-preview-tracker.js';
import { TextureResidency } from './texture-residency.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };
function fixture(
  isTrusted = true,
  options: FixtureAssetOptions = {},
  object: Partial<ImageObject> = {},
) {
  const assets = createFixtureAssetSource(2, {
    assets: { photo: { naturalSize: { width: 4000, height: 3000 } } },
    ...options,
  });
  let identity: string | undefined = 'verified-fixture-v1';
  let shouldIdentityThrow = false;
  let identityRead: () => void = () => undefined;
  const source: AssetSource = {
    ...assets,
    ...(isTrusted
      ? {
          immutableContentIdentity: (assetId) => {
            identityRead();
            if (shouldIdentityThrow) throw new Error('Missing trust');
            return identity === undefined ? undefined : `${identity}:${assetId}`;
          },
        }
      : {}),
  };
  const backend = new FakeGpuBackend();
  const jobs = new ManualJobRunner();
  const images = createImagePassSupport(source, jobs, backend.capabilities.maxTextureSize);
  let tracker: ImagePreviewTracker | undefined;
  const renderer = new SceneRenderer(backend, {
    passes: [IMAGE_PASS],
    environment: {
      images: {
        ...images,
        onManager: (manager) => {
          tracker = imagePreviewOf(manager);
        },
      },
    },
  });
  const pass = renderer.scene.passes[0];
  if (pass === undefined) throw new Error('Missing pass');
  const document = new FakeSceneDocument();
  document.create(imageObject(object));
  renderer.enqueue(document.takeChanges());
  let timeMs = 0;
  const frame = () => renderer.renderFrame({ timeMs: (timeMs += 16), camera: CAMERA });
  const settle = async () => {
    for (let i = 0; i < 8; i += 1) {
      frame();
      await jobs.settle();
    }
  };
  return {
    renderer,
    tracker: () => {
      if (tracker === undefined) throw new Error('Missing tracker');
      return tracker;
    },
    backend,
    pass,
    document,
    frame,
    settle,
    setIdentity: (value: string | undefined) => {
      identity = value;
    },
    onIdentityRead: (listener: () => void) => {
      identityRead = listener;
    },
    throwIdentity: () => {
      shouldIdentityThrow = true;
    },
  };
}

it('refuses placeholders then records the exact target level and resident identity after rendering', async () => {
  const { renderer, pass, frame, settle } = fixture();
  frame();
  expect(readImagePreviewEvidence(pass)).toBeUndefined();
  expect(renderer.readPreviewResources(CAMERA, 'unused')).toBeUndefined();
  await settle();
  const evidence = readImagePreviewEvidence(pass);
  expect(evidence?.images).toHaveLength(1);
  expect(evidence?.images[0]?.plan.levelKey).toBe('photo|L512');
  expect(evidence?.images[0]?.residents[0]?.key).toBe('photo|L512');
  expect(typeof evidence?.images[0]?.residents[0]?.identity).toBe('number');
  if (evidence === undefined) throw new Error('Missing evidence');
  expect(isImagePreviewEvidenceCurrent(pass, evidence)).toBe(true);
  expect(renderer.readPreviewResources(CAMERA, 'unused')?.isCurrent()).toBe(true);
  renderer.destroy();
  expect(isImagePreviewEvidenceCurrent(pass, evidence)).toBe(false);
});

it('never infers identity from a described asset or allows a changed source to reuse old residents', async () => {
  const unsupported = fixture(false);
  await unsupported.settle();
  expect(readImagePreviewEvidence(unsupported.pass)).toBeUndefined();
  unsupported.renderer.destroy();
  const supported = fixture();
  await supported.settle();
  const old = readImagePreviewEvidence(supported.pass);
  expect(old).toBeDefined();
  supported.setIdentity('verified-fixture-v2');
  expect(readImagePreviewEvidence(supported.pass)).toBeUndefined();
  await supported.settle();
  expect(readImagePreviewEvidence(supported.pass)).toBeUndefined();
  supported.renderer.destroy();
});

it('rejects edited evidence and replaces frame proof after crop and natural-size changes', async () => {
  const scene = fixture();
  await scene.settle();
  const old = readImagePreviewEvidence(scene.pass);
  if (old === undefined) throw new Error('Missing evidence');
  Object.assign(old.camera, { zoom: 2 });
  expect(isImagePreviewEvidenceCurrent(scene.pass, old)).toBe(false);
  const beforeCrop = readImagePreviewEvidence(scene.pass);
  if (beforeCrop === undefined) throw new Error('Missing evidence');
  scene.document.update('image-1', { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
  scene.renderer.enqueue(scene.document.takeChanges());
  await scene.settle();
  expect(isImagePreviewEvidenceCurrent(scene.pass, beforeCrop)).toBe(false);
  expect(readImagePreviewEvidence(scene.pass)?.images[0]?.object.crop.width).toBe(0.5);
  scene.document.update('image-1', { naturalSize: { width: 5000, height: 3000 } });
  scene.renderer.enqueue(scene.document.takeChanges());
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  scene.renderer.destroy();
});

it('refuses lower-resolution fallback until the actual target load completes', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scene = fixture(true, {
    beforeFetch: ({ longEdgePx }) => (longEdgePx === 512 ? gate : Promise.resolve()),
  });
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  release();
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)?.images[0]?.plan.levelKey).toBe('photo|L512');
  scene.renderer.destroy();
});

it('does not certify an old completion after trusted content changes in flight', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scene = fixture(true, { beforeFetch: () => gate });
  await scene.settle();
  scene.setIdentity('verified-fixture-v2');
  release();
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  scene.renderer.destroy();
});

it('refuses failed fetches even after the decode queue settles', async () => {
  const scene = fixture(true, {
    beforeFetch: () => Promise.reject(new Error('Refused fixture fetch')),
  });
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  scene.renderer.destroy();
});

it('requires every target tile and records the exact tile set after completion', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const naturalSize = { width: 8000, height: 6000 };
  const scene = fixture(
    true,
    {
      assets: { photo: { naturalSize } },
      beforeFetch: ({ kind }) => (kind === 'tile' ? gate : Promise.resolve()),
    },
    { naturalSize, width: 8000, height: 6000 },
  );
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  release();
  await scene.settle();
  const evidence = readImagePreviewEvidence(scene.pass)?.images[0];
  expect(evidence).toBeDefined();
  expect(evidence?.plan.tiles?.length).toBeGreaterThan(0);
  expect(evidence?.residents.map(({ key }) => key)).toEqual(
    evidence?.plan.tiles?.map(({ key }) => key),
  );
  scene.renderer.destroy();
});

it('rejects evicted residents and an unproven replacement in the same atlas region', async () => {
  const uploads = vi.spyOn(TextureResidency.prototype, 'upload');
  const scene = fixture(true, {}, { width: 100, height: 75 });
  try {
    await scene.settle();
    const evidence = readImagePreviewEvidence(scene.pass);
    if (evidence === undefined) throw new Error('Missing evidence');
    const residency = uploads.mock.contexts[0];
    if (!(residency instanceof TextureResidency)) throw new Error('Missing residency');
    const key = evidence.images[0]?.residents[0]?.key;
    if (key === undefined) throw new Error('Missing resident key');
    const original = residency.get(key);
    if (original === undefined) throw new Error('Missing resident');
    const replacement = residency.upload(
      key,
      {
        widthPx: original.widthPx,
        heightPx: original.heightPx,
        rgba: new Uint8Array(original.widthPx * original.heightPx * 4),
      },
      evidence.frameIndex,
      () => true,
    );
    expect(typeof replacement).toBe('object');
    if (typeof replacement === 'string') throw new Error('Refused replacement');
    expect(replacement.region).toEqual(original.region);
    expect(replacement).not.toBe(original);
    expect(isImagePreviewEvidenceCurrent(scene.pass, evidence)).toBe(false);
    expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
    expect(residency.evict(key)).toBe(true);
    expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  } finally {
    scene.renderer.destroy();
    uploads.mockRestore();
  }
});

it('refuses a throwing trust capability without breaking ordinary rendering', async () => {
  const scene = fixture();
  scene.throwIdentity();
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  expect(() => scene.frame()).not.toThrow();
  scene.renderer.destroy();
});

it('refuses trust withdrawal and texture allocation failure', async () => {
  const scene = fixture();
  await scene.settle();
  expect(readImagePreviewEvidence(scene.pass)).toBeDefined();
  scene.setIdentity(undefined);
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  scene.renderer.destroy();
  const refused = fixture();
  refused.backend.maxLiveTextures = 0;
  await refused.settle();
  expect(readImagePreviewEvidence(refused.pass)).toBeUndefined();
  refused.renderer.destroy();
});

it('invalidates a previously valid proof immediately when its resident is evicted', async () => {
  const uploads = vi.spyOn(TextureResidency.prototype, 'upload');
  const scene = fixture();
  try {
    await scene.settle();
    const evidence = readImagePreviewEvidence(scene.pass);
    const residency = uploads.mock.contexts[0];
    if (evidence === undefined || !(residency instanceof TextureResidency))
      throw new Error('Missing proof');
    const key = evidence.images[0]?.residents[0]?.key;
    if (key === undefined) throw new Error('Missing key');
    expect(isImagePreviewEvidenceCurrent(scene.pass, evidence)).toBe(true);
    expect(residency.evict(key)).toBe(true);
    expect(isImagePreviewEvidenceCurrent(scene.pass, evidence)).toBe(false);
    expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  } finally {
    scene.renderer.destroy();
    uploads.mockRestore();
  }
});

it('bounds provenance by live assets and work during churn while preserving resident proof', async () => {
  const naturalSize = { width: 4000, height: 3000 };
  const assets = Object.fromEntries(
    ['photo', ...Array.from({ length: 32 }, (value, i) => `churn-${String(i)}`)].map((id) => [
      id,
      { naturalSize },
    ]),
  );
  const scene = fixture(true, { assets });
  try {
    await scene.settle();
    for (let index = 0; index < 32; index += 1) {
      scene.document.create(
        imageObject({
          id: 'churn-object' as ImageObject['id'],
          assetId: `churn-${String(index)}` as ImageObject['assetId'],
          width: 100,
          height: 75,
        }),
      );
      scene.renderer.enqueue(scene.document.takeChanges());
      await scene.settle();
      expect(scene.tracker().retainedCounts()).toEqual({ assets: 2, requests: 0, decoded: 0 });
      expect(readImagePreviewEvidence(scene.pass)?.images).toHaveLength(2);
      scene.document.delete('churn-object');
      scene.renderer.enqueue(scene.document.takeChanges());
      await scene.settle();
      expect(scene.tracker().retainedCounts()).toEqual({ assets: 1, requests: 0, decoded: 0 });
      expect(readImagePreviewEvidence(scene.pass)?.images).toHaveLength(1);
    }
  } finally {
    scene.renderer.destroy();
  }
  expect(scene.tracker().retainedCounts()).toEqual({ assets: 0, requests: 0, decoded: 0 });
});

it('rejects a cancelled generation even when the next admission reuses identical source fields', async () => {
  const scene = fixture();
  await scene.settle();
  const tracker = scene.tracker();
  const source = {
    kind: 'server' as const,
    assetId: 'photo' as ImageObject['assetId'],
    longEdgePx: 1024,
  };
  const first = tracker.admit('photo|L1024', source);
  tracker.cancel('photo|L1024');
  const second = tracker.admit('photo|L1024', source);
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  tracker.loaded('photo|L1024', first);
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  expect(tracker.retainedCounts()).toEqual({ assets: 0, requests: 0, decoded: 0 });
  scene.renderer.destroy();
});

it('drops cancelled tile admissions and completed upload provenance without losing live proof', async () => {
  const scene = fixture();
  await scene.settle();
  const tracker = scene.tracker();
  for (let index = 0; index < 256; index += 1) {
    const key = `photo|tile-${String(index)}`;
    const source = tracker.admit(key, {
      kind: 'tile',
      assetId: 'photo' as ImageObject['assetId'],
      longEdgePx: 256,
      tile: { level: 0, column: index, row: 0 },
    });
    if (index % 2 === 0) tracker.cancel(key);
    else {
      tracker.loaded(key, source);
      tracker.uploaded(key);
    }
    expect(tracker.retainedCounts()).toEqual({ assets: 1, requests: 0, decoded: 0 });
  }
  expect(readImagePreviewEvidence(scene.pass)?.images).toHaveLength(1);
  scene.renderer.destroy();
});

it('retains nothing after callback invalidation or subsequent disabled-tracker churn', async () => {
  const scene = fixture();
  await scene.settle();
  const tracker = scene.tracker();
  scene.onIdentityRead(() => {
    tracker.invalidate();
  });
  tracker.observe('photo' as ImageObject['assetId']);
  for (let index = 0; index < 256; index += 1) {
    const assetId = `disabled-${String(index)}` as ImageObject['assetId'];
    const key = `${assetId}|L128`;
    tracker.observe(assetId);
    const source = tracker.admit(key, { kind: 'server', assetId, longEdgePx: 128 });
    tracker.loaded(key, source);
    tracker.uploaded(key);
    expect(tracker.retainedCounts()).toEqual({ assets: 0, requests: 0, decoded: 0 });
  }
  expect(readImagePreviewEvidence(scene.pass)).toBeUndefined();
  scene.renderer.destroy();
});
