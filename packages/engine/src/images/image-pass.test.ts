import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { ManualJobRunner } from './__fixtures__/manual-job-runner.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import { MAX_TILE_PARTS } from './image-needs.js';
import { createImagePassSupport } from './image-pass-support.js';
import { IMAGE_LEVEL_OF_DETAIL, IMAGE_PASS, IMAGE_PASS_NAME } from './image-pass.js';

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1000,
  viewportHeightPx: 800,
  dpr: 1,
};
const PHOTO = fixtureAssetId('photo');

function setUp(backend = new FakeGpuBackend()) {
  const jobs = new ManualJobRunner();
  const ledger = new MemoryLedger();
  const assets = createFixtureAssetSource(2, {
    assets: { [PHOTO]: { naturalSize: { width: 4000, height: 3000 } } },
  });
  const images = createImagePassSupport(assets, jobs, backend.capabilities.maxTextureSize);
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, IMAGE_PASS],
    environment: { ledger, images },
  });
  const document = new FakeSceneDocument();
  let timeMs = 0;
  const frame = (camera = CAMERA) => {
    timeMs += 16;
    return renderer.renderFrame({ timeMs, camera });
  };
  const settle = async (camera = CAMERA) => {
    const stats = [];
    for (let round = 0; round < 6; round += 1) {
      stats.push(frame(camera));
      await jobs.settle();
    }
    return stats;
  };
  return { backend, jobs, ledger, renderer, document, frame, settle };
}

describe('IMAGE_PASS', () => {
  it('gives an image one record, a tileable image one per tile, and other objects none', () => {
    const { renderer, document } = setUp();
    document.create(
      imageObject({ id: 'small' as ObjectId }),
      imageObject({ id: 'huge' as ObjectId, naturalSize: { width: 8000, height: 6000 } }),
      shapeObject('rect'),
    );
    renderer.enqueue(document.takeChanges());

    renderer.renderFrame({ timeMs: 0, camera: CAMERA });

    const { scene } = renderer;
    expect(scene.slotsOf('small' as ObjectId, IMAGE_PASS_NAME)).toHaveLength(1);
    expect(scene.slotsOf('huge' as ObjectId, IMAGE_PASS_NAME)).toHaveLength(MAX_TILE_PARTS);
    expect(scene.slotsOf('rect' as ObjectId, IMAGE_PASS_NAME)).toHaveLength(0);
  });

  it('flags an image at any opacity above 0, so a faded image still draws over text below it', () => {
    const pass = IMAGE_PASS.create({
      backend: new FakeGpuBackend(),
      requestFrame: () => undefined,
      now: () => 0,
    });

    expect(pass.isOccluder?.(imageObject())).toBe(true);
    expect(pass.isOccluder?.(imageObject({ opacity: 0.5 }))).toBe(true);
    expect(pass.isOccluder?.(imageObject({ opacity: 0 }))).toBe(false);
    expect(pass.isOccluder?.(shapeObject('rect'))).toBe(false);
  });

  it('draws the placeholder first, then the level, rewriting the record without a change', async () => {
    const { backend, renderer, document, frame, settle } = setUp();
    document.create(imageObject());
    renderer.enqueue(document.takeChanges());

    frame();
    const placeholderDraws = backend.calls.filter((call) => call.method === 'setBindGroup');
    backend.resetCalls();
    const stats = await settle();

    expect(placeholderDraws).toEqual([
      { method: 'setBindGroup', textureLabel: 'image placeholder' },
    ]);
    // The level arrived: the record was rewritten (no document change) and draws from its page.
    const imageWrites = backend.writes().filter(({ label }) => label === 'image instances');
    expect(imageWrites.length).toBeGreaterThan(0);
    expect(stats.every(({ changedObjects }) => changedObjects === 0)).toBe(true);
    backend.resetCalls();
    frame();
    expect(backend.calls.filter((call) => call.method === 'setBindGroup')).toEqual([
      { method: 'setBindGroup', textureLabel: 'image photo|L512' },
    ]);
  });

  it('lands a pending image at its retained position and forgets it after deletion', async () => {
    const { backend, renderer, document, frame, settle } = setUp();
    const image = imageObject();
    const ids = [image.id];
    document.create(image);
    renderer.enqueue(document.takeChanges());
    frame();
    document.update(image.id, { x: 31.125, y: -13.5 });
    renderer.enqueueRetainedMove(document.takeChanges(), ids);
    frame();
    document.update(image.id, { x: 77.77777777, y: 22.333333333 });
    renderer.enqueueRetainedMove(document.takeChanges(), ids);
    frame();
    expect(backend.textures.some((texture) => texture.label === 'move-transform-table')).toBe(true);
    const stats = await settle();
    expect(stats.every(({ blankImages }) => blankImages === 0)).toBe(true);
    const buffer = renderer.scene.instanceBufferOf(IMAGE_PASS_NAME);
    const [slot = 0] = renderer.scene.slotsOf(image.id, IMAGE_PASS_NAME);
    const offset = slot * buffer.layout.floatsPerRecord;
    expect([...buffer.data.slice(offset, offset + 2)]).toEqual([
      Math.fround(77.77777777),
      Math.fround(22.333333333),
    ]);
    backend.resetCalls();
    frame();
    expect(backend.calls.filter((call) => call.method === 'setBindGroup')).toContainEqual({
      method: 'setBindGroup',
      textureLabel: 'image photo|L512',
    });
    document.delete(image.id);
    renderer.enqueue(document.takeChanges());
    frame();
    expect(renderer.scene.slotsOf(image.id, IMAGE_PASS_NAME)).toHaveLength(0);
    expect(
      backend.textures
        .filter((texture) => texture.label === 'move-transform-table')
        .every((texture) => texture.isDestroyed),
    ).toBe(true);
    backend.resetCalls();
    await settle();
    expect(backend.calls.filter((call) => call.method === 'draw')).toHaveLength(0);
    renderer.destroy();
  });

  it('reports texture bytes to the ledger it is given', async () => {
    const { ledger, renderer, document, settle } = setUp();
    document.create(imageObject());
    renderer.enqueue(document.takeChanges());

    await settle();

    // A 2048² atlas page for the 128 level and the 512 × 384 level's own texture.
    expect(ledger.bytesOf('textures')).toBe(2048 * 2048 * 4 + 512 * 384 * 4);
  });

  it('counts a visible image of a ready asset drawn without a texture as blank', async () => {
    const backend = new FakeGpuBackend();
    // Only the clip table and the placeholder texel fit: the image's levels decode but cannot be
    // uploaded.
    backend.maxLiveTextures = 2;
    const { renderer, document, settle } = setUp(backend);
    document.create(imageObject());
    renderer.enqueue(document.takeChanges());

    const stats = await settle();

    expect(stats[0]?.blankImages).toBe(0);
    expect(stats.at(-1)?.blankImages).toBe(1);
  });

  it('draws an image under 8 device px on its longer edge in its average colour, never blank', async () => {
    const { backend, renderer, document, frame, settle } = setUp();
    document.create(imageObject());
    renderer.enqueue(document.takeChanges());
    await settle();
    const scene = renderer.scene;
    const [slot = 0] = scene.slotsOf('image-1' as ObjectId, IMAGE_PASS_NAME);
    const buffer = scene.instanceBufferOf(IMAGE_PASS_NAME);
    /**
     * The record's texture weight after a frame at a zoom: 0 draws the average colour.
     *
     * @param zoom - The zoom.
     * @returns The weight.
     */
    const textureWeightAt = (zoom: number): number | undefined => {
      frame({ ...CAMERA, zoom });
      return buffer.data[slot * buffer.layout.floatsPerRecord + 21];
    };
    expect(textureWeightAt(1)).toBe(1);
    // 400 units wide: 6 device px at 0.015.
    const far = { ...CAMERA, zoom: 0.015 };
    const stats = await settle(far);
    expect(textureWeightAt(0.015)).toBe(0);
    // It still counts as drawn, not blank, and stays on its level's page: it samples nothing.
    expect(stats.every(({ blankImages }) => blankImages === 0)).toBe(true);
    backend.resetCalls();
    frame(far);
    expect(backend.calls.filter((call) => call.method === 'setBindGroup')).not.toContainEqual({
      method: 'setBindGroup',
      textureLabel: 'image placeholder',
    });
    // 9 px: past 8 px but inside the band; 10 px: its level again.
    expect(textureWeightAt(0.0225)).toBe(0);
    expect(textureWeightAt(0.025)).toBe(1);
  });

  it('uses the fitted edge and refreshes it after crop or natural-size changes', async () => {
    const { renderer, document, frame, settle } = setUp();
    document.create(imageObject({ width: 400, height: 30 }));
    renderer.enqueue(document.takeChanges());
    const camera = { ...CAMERA, zoom: 0.15 };
    await settle(camera);
    const [slot = 0] = renderer.scene.slotsOf('image-1' as ObjectId, IMAGE_PASS_NAME);
    const buffer = renderer.scene.instanceBufferOf(IMAGE_PASS_NAME);
    const weight = () => buffer.data[slot * buffer.layout.floatsPerRecord + 21];
    // Stored long edge is 60 device pixels, but the fitted 40 × 30 image is only 6.
    expect(weight()).toBe(0);
    document.update('image-1', { crop: { x: 0, y: 0, width: 1, height: 0.1 } });
    renderer.enqueue(document.takeChanges());
    expect(frame(camera).blankImages).toBe(0);
    expect(weight()).toBe(1); // Crop now fills the 400 × 30 box.
    document.update('image-1', { naturalSize: { width: 400, height: 3000 } });
    renderer.enqueue(document.takeChanges());
    expect(frame(camera).blankImages).toBe(0);
    expect(weight()).toBe(0); // Same crop and box, but fitted long edge is 40 again.
  });

  it('measures an image again when any fitted-size input changes', () => {
    const image = imageObject();
    const isSameSize = IMAGE_LEVEL_OF_DETAIL.isSameSize;
    if (isSameSize === undefined) throw new Error('the image rule tells same sizes');
    expect(isSameSize(image, { ...image, x: 40, opacity: 0.5 })).toBe(true);
    expect(isSameSize(image, { ...image, width: image.width + 1 })).toBe(false);
    expect(isSameSize(image, { ...image, height: image.height + 1 })).toBe(false);
    expect(isSameSize(image, { ...image, crop: { ...image.crop, x: 0.1, y: 0.2 } })).toBe(true);
    expect(isSameSize(image, { ...image, crop: { ...image.crop, width: 0.5 } })).toBe(false);
    expect(isSameSize(image, { ...image, crop: { ...image.crop, height: 0.5 } })).toBe(false);
    expect(
      isSameSize(image, { ...image, naturalSize: { ...image.naturalSize, width: 2000 } }),
    ).toBe(false);
    expect(
      isSameSize(image, { ...image, naturalSize: { ...image.naturalSize, height: 2000 } }),
    ).toBe(false);
    expect(isSameSize(image, shapeObject('image-1'))).toBe(false);
  });
});
