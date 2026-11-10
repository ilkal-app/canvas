import { expect, it } from 'vitest';

import type { AssetId, ImagePaint, ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { RECT_IMAGE_PASS_NAME, RECT_IMAGE_PASS } from '../scene/rect-image-pass.js';
import type { ScenePassEntry } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SDF_SHAPE_GRADIENT_PASS } from '../shapes/shape-gradient-pass.js';
import { SDF_SHAPE_IMAGE_PASS, SDF_SHAPE_IMAGE_PASS_NAME } from '../shapes/shape-image-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { ManualJobRunner } from './__fixtures__/manual-job-runner.js';
import type { AssetSource } from './asset-source.js';
import { createFixtureAssetSource } from './fixture-asset-source.js';
import { createImagePassSupport } from './image-pass-support.js';
import { IMAGE_PASS } from './image-pass.js';
import type { TextureManager } from './texture-manager.js';

// The image pass and the image-fill passes share one texture manager per renderer.

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1000, viewportHeightPx: 800, dpr: 1 };

const paint: ImagePaint = {
  type: 'image',
  assetId: 'photo' as AssetId,
  naturalSize: { width: 4000, height: 3000 },
  fit: 'fill',
  crop: { x: 0, y: 0, width: 1, height: 1 },
};

function fixture(passes: readonly ScenePassEntry[]) {
  const assets = createFixtureAssetSource(2, {
    assets: { photo: { naturalSize: { width: 4000, height: 3000 } } },
  });
  // A trusted source, so the preview certificate can name what it shows.
  const source: AssetSource = {
    ...assets,
    immutableContentIdentity: (assetId) => `fixture-v1:${assetId}`,
  };
  const backend = new FakeGpuBackend();
  const jobs = new ManualJobRunner();
  const managers: TextureManager[] = [];
  const renderer = new SceneRenderer(backend, {
    passes,
    environment: {
      images: {
        ...createImagePassSupport(source, jobs, backend.capabilities.maxTextureSize),
        onManager: (manager) => {
          managers.push(manager);
        },
      },
    },
  });
  const document = new FakeSceneDocument();
  let timeMs = 0;
  const frame = () => renderer.renderFrame({ timeMs: (timeMs += 16), camera: CAMERA });
  const settle = async () => {
    for (let i = 0; i < 8; i += 1) {
      frame();
      await jobs.settle();
    }
  };
  const passNamed = (name: string) => {
    const pass = renderer.scene.passes.find((candidate) => candidate.name === name);
    if (pass === undefined) throw new Error(`Missing ${name}`);
    return pass;
  };
  return { renderer, document, managers, frame, settle, passNamed };
}

it('forgets an object only for the pass that tracked it', async () => {
  const { renderer, document, managers, settle, passNamed } = fixture([
    RECT_IMAGE_PASS,
    SDF_SHAPE_IMAGE_PASS,
  ]);
  document.create(shapeObject('s', { fill: paint, width: 400, height: 300 }));
  renderer.enqueue(document.takeChanges());
  await settle();
  const manager = managers[0];
  const id = 's' as ObjectId;
  expect(manager?.bindingOf(id).parts[0]?.source).toBeDefined();

  passNamed(RECT_IMAGE_PASS_NAME).forget?.(id);
  expect(manager?.bindingOf(id).parts[0]?.source).toBeDefined();
  passNamed(SDF_SHAPE_IMAGE_PASS_NAME).forget?.(id);
  expect(manager?.bindingOf(id).parts[0]?.source).toBeUndefined();
  renderer.destroy();
});

it('moves a shape between the solid, image and gradient passes, tracked only while image-filled', async () => {
  const { renderer, document, managers, frame, settle } = fixture([
    SDF_SHAPE_PASS,
    SDF_SHAPE_GRADIENT_PASS,
    SDF_SHAPE_IMAGE_PASS,
  ]);
  const id = 's' as ObjectId;
  const slots = () =>
    ['sdf-shape', 'sdf-shape-gradient', SDF_SHAPE_IMAGE_PASS_NAME].map(
      (pass) => renderer.scene.slotsOf(id, pass).length,
    );
  document.create(shapeObject('s', { width: 400, height: 300 }));
  renderer.enqueue(document.takeChanges());
  frame();
  expect(slots()).toEqual([1, 0, 0]);
  expect(managers).toHaveLength(0);

  document.update('s', { fill: paint });
  renderer.enqueue(document.takeChanges());
  await settle();
  expect(slots()).toEqual([0, 0, 1]);
  expect(managers[0]?.bindingOf(id).parts[0]?.source).toBeDefined();

  const gradient = {
    type: 'linear' as const,
    angle: 0,
    stops: [
      { offset: 0, color: [1, 0, 0, 1] as [number, number, number, number] },
      { offset: 1, color: [0, 0, 1, 1] as [number, number, number, number] },
    ],
  };
  document.update('s', { fill: gradient });
  renderer.enqueue(document.takeChanges());
  frame();
  expect(slots()).toEqual([0, 1, 0]);
  expect(managers[0]?.bindingOf(id).parts[0]?.source).toBeUndefined();

  document.update('s', { fill: paint });
  renderer.enqueue(document.takeChanges());
  await settle();
  expect(slots()).toEqual([0, 0, 1]);
  document.update('s', { fill: [0, 0.5, 0, 1] });
  renderer.enqueue(document.takeChanges());
  frame();
  expect(slots()).toEqual([1, 0, 0]);
  expect(managers[0]?.bindingOf(id).parts[0]?.source).toBeUndefined();
  renderer.destroy();
});

it('keeps the manager until the last pass leaves', async () => {
  const { renderer, document, managers, settle, passNamed } = fixture([
    RECT_IMAGE_PASS,
    SDF_SHAPE_IMAGE_PASS,
  ]);
  document.create(shapeObject('s', { fill: paint, width: 400, height: 300 }));
  renderer.enqueue(document.takeChanges());
  await settle();
  const manager = managers[0];
  expect(manager?.residentKeys().length).toBeGreaterThan(0);

  passNamed(RECT_IMAGE_PASS_NAME).destroy?.();
  expect(manager?.residentKeys().length).toBeGreaterThan(0);
  renderer.destroy();
  expect(manager?.residentKeys()).toEqual([]);
});

it('certifies a preview with one manager’s evidence, fills and images together', async () => {
  const { renderer, document, managers, settle } = fixture([IMAGE_PASS, SDF_SHAPE_IMAGE_PASS]);
  document.create(
    imageObject({ id: 'i' as ObjectId }),
    shapeObject('s', { fill: paint, x: 500, width: 400, height: 300 }),
  );
  renderer.enqueue(document.takeChanges());
  await settle();

  expect(managers).toHaveLength(1);
  const resources = renderer.readPreviewResources(CAMERA, 'unused');
  expect(resources?.images).toHaveLength(1);
  expect(resources?.images[0]?.images.map(({ object }) => [object.id, object.type]).sort()).toEqual(
    [
      ['i', 'image'],
      ['s', 'image-paint'],
    ],
  );
  expect(resources?.isCurrent()).toBe(true);
  renderer.destroy();
});

it('certifies an image-fill pass with nothing to draw, until a fill arrives', async () => {
  const { renderer, document, managers, frame, settle } = fixture([SDF_SHAPE_IMAGE_PASS]);
  document.create(shapeObject('plain'));
  renderer.enqueue(document.takeChanges());
  frame();
  const idle = renderer.readPreviewResources(CAMERA, 'unused');
  expect(idle?.images).toEqual([]);
  expect(managers).toHaveLength(0);

  document.create(shapeObject('s', { fill: paint, width: 400, height: 300 }));
  renderer.enqueue(document.takeChanges());
  frame();
  expect(idle?.isCurrent()).toBe(false);
  await settle();
  expect(renderer.readPreviewResources(CAMERA, 'unused')?.images).toHaveLength(1);
  renderer.destroy();
});
