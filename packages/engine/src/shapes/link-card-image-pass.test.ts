import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { ManualJobRunner } from '../images/__fixtures__/manual-job-runner.js';
import { createFixtureAssetSource, fixtureAssetId } from '../images/fixture-asset-source.js';
import { createImagePassSupport } from '../images/image-pass-support.js';
import type { TextureManager } from '../images/texture-manager.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { FRAME_CORNER_RADII_FLOAT, FRAME_SHAPE_FLOATS } from '../scene/frame-shape-record.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { linkCard } from './__fixtures__/link-cards.js';
import {
  LINK_ICON_PASS,
  LINK_ICON_PASS_NAME,
  LINK_PREVIEW_PASS,
  LINK_PREVIEW_PASS_NAME,
} from './link-card-image-pass.js';
import { SDF_SHAPE_PASS } from './shape-pass.js';

// A link card's preview and site icon, image fills of the shared texture manager.

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1000,
  viewportHeightPx: 800,
  dpr: 1,
};
const PHOTO = fixtureAssetId('photo');
const ICON = fixtureAssetId('icon');
const IDENTITY = { x: 0, y: 0, cos: 1, sin: 0 };

/**
 * A ready card with both images.
 *
 * @param id - Its id.
 * @param x - Its left edge.
 * @returns The card.
 */
function illustrated(id = 'card', x = 0) {
  return linkCard({
    id: id as ObjectId,
    x,
    y: 0,
    imageAssetId: PHOTO,
    imageSize: { width: 1200, height: 630 },
    faviconAssetId: ICON,
    faviconSize: { width: 32, height: 32 },
  });
}

/**
 * A pass built alone.
 *
 * @param factory - Which pass.
 * @param factory.create - Builds it.
 * @returns The pass.
 */
function alone(factory: { create: typeof LINK_PREVIEW_PASS.create }): ScenePass {
  return factory.create({
    backend: new FakeGpuBackend(),
    requestFrame: () => undefined,
    now: () => 0,
  });
}

/**
 * A renderer with the shape pass and both image passes over fixture assets.
 *
 * @returns The renderer, its document, managers and frame helpers.
 */
function setUp() {
  const backend = new FakeGpuBackend();
  const jobs = new ManualJobRunner();
  const managers: TextureManager[] = [];
  const assets = createFixtureAssetSource(2, {
    assets: {
      [PHOTO]: { naturalSize: { width: 1200, height: 630 } },
      [ICON]: { naturalSize: { width: 32, height: 32 } },
    },
  });
  const images = {
    ...createImagePassSupport(assets, jobs, backend.capabilities.maxTextureSize),
    onManager: (manager: TextureManager) => {
      managers.push(manager);
    },
  };
  const renderer = new SceneRenderer(backend, {
    passes: [SDF_SHAPE_PASS, LINK_PREVIEW_PASS, LINK_ICON_PASS],
    environment: { ledger: new MemoryLedger(), images },
  });
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

describe('the link card image passes', () => {
  it('draw a card’s preview and icon only where it has them, one record each', () => {
    const preview = alone(LINK_PREVIEW_PASS);
    const icon = alone(LINK_ICON_PASS);
    const card = illustrated();
    expect([preview.recordCount(card), icon.recordCount(card)]).toEqual([1, 1]);
    expect([preview.recordCount(linkCard()), icon.recordCount(linkCard())]).toEqual([0, 0]);
    const failed = { ...card, status: 'failed' as const };
    expect(preview.recordCount(failed)).toBe(0);
    // An asset without its size cannot be laid in.
    expect(preview.recordCount(linkCard({ imageAssetId: PHOTO }))).toBe(0);
  });

  it('place the preview inside the hairline, rounded at the card’s corners only', () => {
    const pass = alone(LINK_PREVIEW_PASS);
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: illustrated(), transform: { ...IDENTITY, x: 100 } }, 0);
    expect([...record.slice(0, 4)]).toEqual([101, 1, 318, 167]);
    const radii = record.slice(FRAME_CORNER_RADII_FLOAT, FRAME_CORNER_RADII_FLOAT + 4);
    expect([...radii]).toEqual([9, 9, 0, 0]);
    const wide = { ...illustrated(), layout: 'horizontal' as const, width: 440, height: 120 };
    pass.prepare(record, { object: wide, transform: IDENTITY }, 0);
    const wideRadii = record.slice(FRAME_CORNER_RADII_FLOAT, FRAME_CORNER_RADII_FLOAT + 4);
    expect([...wideRadii]).toEqual([9, 0, 0, 9]);
  });

  it('cover the preview with the image at its own proportions, cutting what overflows', () => {
    const pass = alone(LINK_PREVIEW_PASS);
    const record = new Float32Array(pass.layout.floatsPerRecord);
    const square = { ...illustrated(), imageSize: { width: 1000, height: 1000 } };
    pass.prepare(record, { object: square, transform: IDENTITY }, 0);
    // The tail's crop, in the image's fractions: the full width, a centred band of its height
    // (the 318 × 167 box's aspect), not the whole image stretched.
    const [u0, v0, u1, v1] = record.slice(FRAME_SHAPE_FLOATS, FRAME_SHAPE_FLOATS + 4);
    expect(u0).toBeCloseTo(0, 5);
    expect(u1).toBeCloseTo(1, 5);
    expect((v1 ?? 0) - (v0 ?? 0)).toBeCloseTo(167 / 318, 3);
    expect(v0).toBeCloseTo((1 - 167 / 318) / 2, 3);
  });

  it('place the icon at the footer, turned with the card', () => {
    const pass = alone(LINK_ICON_PASS);
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: illustrated(), transform: { x: 0, y: 0, cos: 0, sin: 1 } }, 0);
    // The icon's corner (12, 256) in the card's frame, turned a quarter.
    expect([...record.slice(0, 4)]).toEqual([-256, 12, 10, 10]);
    expect([record[11], record[12]]).toEqual([0, 1]);
  });

  it('track both images in the shared manager, the icon under its own id', async () => {
    const { backend, renderer, document, managers, settle, frame } = setUp();
    document.create(illustrated());
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(managers).toHaveLength(1);
    const [manager] = managers;
    expect(manager?.bindingOf('card' as ObjectId).parts[0]?.source).toBeDefined();
    expect(manager?.bindingOf('card#icon' as ObjectId).parts[0]?.source).toBeDefined();
    expect(renderer.scene.slotsOf('card' as ObjectId, LINK_PREVIEW_PASS_NAME)).toHaveLength(1);
    expect(renderer.scene.slotsOf('card' as ObjectId, LINK_ICON_PASS_NAME)).toHaveLength(1);
    // Each record was rewritten for its level: both draw from an image page, not the placeholder.
    backend.resetCalls();
    frame();
    const labels = backend.calls
      .filter((call) => call.method === 'setBindGroup')
      .map((call) => (call as { textureLabel?: string }).textureLabel);
    expect(labels).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^image photo\|L/),
        // A small image is packed into the atlas.
        expect.stringMatching(/^image (icon\|L|atlas)/),
      ]),
    );
    expect(labels).not.toContain('image placeholder');
    renderer.destroy();
  });

  it('forget the icon with its card', async () => {
    const { renderer, document, managers, settle } = setUp();
    document.create(illustrated());
    renderer.enqueue(document.takeChanges());
    await settle();
    document.delete('card');
    renderer.enqueue(document.takeChanges());
    await settle();
    const [manager] = managers;
    expect(manager?.bindingOf('card#icon' as ObjectId).parts[0]?.source).toBeUndefined();
    renderer.destroy();
  });
});
