import { describe, expect, it } from 'vitest';

import type { ImagePaint, ObjectId, ShapeObject } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { imageObject } from '../images/__fixtures__/image-objects.js';
import { ManualJobRunner } from '../images/__fixtures__/manual-job-runner.js';
import { createFixtureAssetSource, fixtureAssetId } from '../images/fixture-asset-source.js';
import { IMAGE_FILL_TAIL_FLOATS } from '../images/image-fill-record.js';
import { createImagePassSupport } from '../images/image-pass-support.js';
import { IMAGE_PASS } from '../images/image-pass.js';
import type { TextureManager } from '../images/texture-manager.js';
import type { LevelOfDetail } from '../lod/level-of-detail.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import { RECT_IMAGE_PASS, RECT_IMAGE_PASS_NAME } from '../scene/rect-image-pass.js';
import type { ScenePass, ScenePassEntry, ScenePassEnvironment } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import { SDF_SHAPE_GRADIENT_PASS } from './shape-gradient-pass.js';
import {
  SDF_SHAPE_IMAGE_PASS,
  SDF_SHAPE_IMAGE_PASS_NAME,
  SHAPE_IMAGE_INSTANCE_LAYOUT,
} from './shape-image-pass.js';
import { SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';
import { SDF_SHAPE_PASS } from './shape-pass.js';

// Image paints on shapes and frame backgrounds, drawn from the renderer's one texture
// manager.

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;
const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1000,
  viewportHeightPx: 800,
  dpr: 1,
};
const PHOTO = fixtureAssetId('photo');

const imagePaint = (fields: Partial<ImagePaint> = {}): ImagePaint => ({
  type: 'image',
  assetId: PHOTO,
  naturalSize: { width: 4000, height: 3000 },
  fit: 'fill',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  ...fields,
});

const imageShape = (id: string, fields: Partial<ShapeObject> = {}) =>
  shapeObject(id, { fill: imagePaint(), width: 400, height: 300, ...fields });

function passWith(form?: string): ScenePass {
  const environment: ScenePassEnvironment = {
    backend: new FakeGpuBackend(),
    requestFrame: () => undefined,
    now: () => 0,
    ...(form === undefined
      ? {}
      : { levelOfDetail: { formOf: () => form } as unknown as LevelOfDetail }),
  };
  return SDF_SHAPE_IMAGE_PASS.create(environment);
}

function setUp(passes: readonly ScenePassEntry[] = [SDF_SHAPE_IMAGE_PASS]) {
  const backend = new FakeGpuBackend();
  const jobs = new ManualJobRunner();
  const ledger = new MemoryLedger();
  const managers: TextureManager[] = [];
  const assets = createFixtureAssetSource(2, {
    assets: { [PHOTO]: { naturalSize: { width: 4000, height: 3000 } } },
  });
  const images = {
    ...createImagePassSupport(assets, jobs, backend.capabilities.maxTextureSize),
    onManager: (manager: TextureManager) => {
      managers.push(manager);
    },
  };
  const renderer = new SceneRenderer(backend, { passes, environment: { ledger, images } });
  const document = new FakeSceneDocument();
  let timeMs = 0;
  const frame = () => {
    timeMs += 16;
    return renderer.renderFrame({ timeMs, camera: CAMERA });
  };
  const settle = async () => {
    for (let round = 0; round < 6; round += 1) {
      frame();
      await jobs.settle();
    }
  };
  return { backend, renderer, document, managers, frame, settle };
}

describe('SDF_SHAPE_IMAGE_PASS', () => {
  it('draws image-filled shapes the solid and gradient passes leave, one record each', () => {
    const pass = passWith();
    const filled = imageShape('filled');
    const solid = shapeObject('solid');
    expect([pass.recordCount(filled), SDF_SHAPE_PASS.recordCount(filled)]).toEqual([1, 0]);
    expect(SDF_SHAPE_GRADIENT_PASS.create(passEnvironment()).recordCount(filled)).toBe(0);
    expect([pass.recordCount(solid), SDF_SHAPE_PASS.recordCount(solid)]).toEqual([0, 1]);
    expect(pass.isOccluder?.(filled)).toBe(true);
    expect(SDF_SHAPE_PASS.isOccluder?.(filled)).toBe(false);
    // A paint the schema refuses draws as no fill: neither pass draws its fill.
    const refused = imageShape('refused', { fill: { ...imagePaint(), fit: 'stretch' } as never });
    expect(pass.recordCount(refused)).toBe(0);
  });

  it('is the SDF shape record, the image-fill tail at locations 8 to 11, then the clip index and transparency', () => {
    expect(SHAPE_IMAGE_INSTANCE_LAYOUT.floatsPerRecord).toBe(
      SHAPE_INSTANCE_FLOATS + IMAGE_FILL_TAIL_FLOATS + 2,
    );
    expect(
      SHAPE_IMAGE_INSTANCE_LAYOUT.vertexBufferLayout.attributes.slice(-6).map((a) => a.location),
    ).toEqual([8, 9, 10, 11, 14, 12]);
  });

  it('writes the shape record with the image’s colour as its placeholder, and the outline', () => {
    const pass = passWith();
    const stroke = { color: [0, 0.5, 0, 1] as [number, number, number, number], width: 3 };
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: imageShape('s', { stroke }), transform: IDENTITY }, 0);
    expect([...record.slice(0, 4)]).toEqual([0, 0, 400, 300]);
    expect(record[7]).toBeGreaterThan(0);
    expect([...record.slice(13, 18)]).toEqual([0, 0.5, 0, 1, 3]);
    // No level yet: the placeholder colour, mode clamp.
    expect([...record.slice(SHAPE_INSTANCE_FLOATS + 12, SHAPE_INSTANCE_FLOATS + 14)]).toEqual([
      0, 0,
    ]);
  });

  it('draws the placeholder first, then the level, rewriting the record without a change', async () => {
    const { backend, renderer, document, frame, settle } = setUp();
    document.create(imageShape('s'));
    renderer.enqueue(document.takeChanges());

    frame();
    expect(backend.calls.filter((call) => call.method === 'setBindGroup')).toEqual([
      { method: 'setBindGroup', textureLabel: 'image placeholder' },
    ]);
    await settle();
    backend.resetCalls();
    frame();
    expect(backend.calls.filter((call) => call.method === 'setBindGroup')).toEqual([
      { method: 'setBindGroup', textureLabel: expect.stringMatching(/^image photo\|L/) as unknown },
    ]);
    const slots = renderer.scene.slotsOf('s' as ObjectId, SDF_SHAPE_IMAGE_PASS_NAME);
    expect(slots).toHaveLength(1);
  });

  it('shares one texture manager with the image pass and the frame-background pass', async () => {
    const { renderer, document, managers, settle } = setUp([
      SOLID_RECT_PASS,
      RECT_IMAGE_PASS,
      SDF_SHAPE_IMAGE_PASS,
      IMAGE_PASS,
    ]);
    document.create(
      frameObject('f', { background: imagePaint({ fit: 'crop' }), width: 200, height: 200 }),
      imageShape('s', { x: 300 }),
      imageObject({ id: 'i' as ObjectId, x: 600 }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();

    expect(managers).toHaveLength(1);
    const [manager] = managers;
    expect(manager?.bindingOf('f' as ObjectId).parts[0]?.source).toBeDefined();
    expect(manager?.bindingOf('s' as ObjectId).parts[0]?.source).toBeDefined();
    expect(manager?.bindingOf('i' as ObjectId).parts[0]?.source).toBeDefined();
    expect(renderer.scene.slotsOf('f' as ObjectId, RECT_IMAGE_PASS_NAME)).toHaveLength(1);
    expect(renderer.scene.slotsOf('f' as ObjectId, SOLID_RECT_PASS.name)).toHaveLength(0);
    renderer.destroy();
  });

  it('creates no texture manager on a board without an image fill', () => {
    const { renderer, document, managers, frame } = setUp([SOLID_RECT_PASS, SDF_SHAPE_IMAGE_PASS]);
    document.create(shapeObject('plain'), frameObject('f'));
    renderer.enqueue(document.takeChanges());
    frame();
    expect(managers).toHaveLength(0);
    renderer.destroy();
  });

  it('draws the placeholder colour in the average-colour form', () => {
    const pass = passWith('average-color');
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: imageShape('s'), transform: IDENTITY }, 0);
    expect(record[SHAPE_INSTANCE_FLOATS + 12]).toBe(0);
  });
});

describe('RECT_IMAGE_PASS', () => {
  it('draws a frame’s image background as a sharp box without an outline', () => {
    const pass = RECT_IMAGE_PASS.create(passEnvironment());
    const frame = frameObject('f', { background: imagePaint(), width: 120, height: 80 });
    expect(pass.recordCount(frame)).toBe(1);
    expect(pass.recordCount(frameObject('solid'))).toBe(0);
    expect(SOLID_RECT_PASS.recordCount(frame)).toBe(0);
    expect(pass.isOccluder?.(frame)).toBe(true);
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: frame, transform: { cos: 0, sin: 1, x: 5, y: 6 } }, 0);
    expect([...record.slice(0, 4)]).toEqual([5, 6, 120, 80]);
    expect([record[8], record[11], record[12], record[17]]).toEqual([0, 0, 1, 0]);
    // A sharp frame's corner radii are zeros, before the image tail.
    expect([...record.slice(SHAPE_INSTANCE_FLOATS, SHAPE_INSTANCE_FLOATS + 4)]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('rounds a rounded frame’s image background, each corner capped', () => {
    const pass = RECT_IMAGE_PASS.create(passEnvironment());
    const frame = frameObject('f', {
      background: imagePaint(),
      width: 120,
      height: 80,
      cornerRadius: [4, 0, 100, 12],
    });
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: frame, transform: IDENTITY }, 0);
    expect([...record.slice(SHAPE_INSTANCE_FLOATS, SHAPE_INSTANCE_FLOATS + 4)]).toEqual([
      4, 0, 40, 12,
    ]);
    expect(pass.layout.clipFloat).toBe(pass.layout.floatsPerRecord - 2);
    expect(pass.layout.opacityFloat).toBe(pass.layout.floatsPerRecord - 1);
  });
});

function passEnvironment(): ScenePassEnvironment {
  return { backend: new FakeGpuBackend(), requestFrame: () => undefined, now: () => 0 };
}
