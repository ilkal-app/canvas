import { describe, expect, it, vi } from 'vitest';

import type { ImageObject, ObjectId } from '@canvas/schema';

import { visibleWorldBounds, type Camera } from '../camera/camera.js';
import { seededRandom } from '../spatial/__fixtures__/random-boxes.js';
import { intersectsBounds } from '../spatial/bounds.js';

import { imageObject } from './__fixtures__/image-objects.js';
import {
  cameraAt,
  TextureManagerHarness,
  type HarnessSettings,
} from './__fixtures__/texture-manager-harness.js';
import { settledWideBoard, varyingDrag } from './__fixtures__/wide-board.js';
import {
  createFixtureAssetSource,
  fixtureAssetId,
  type FixtureAssetSpec,
} from './fixture-asset-source.js';
import { ImagePlanner } from './image-planner.js';

// Pans at an unchanged zoom that plan nothing (`CandidateFinder.pan`), and what they must not
// cost: a tiled image near the view gets its tiles when it comes on screen, and a camera that
// comes to rest ends in the same picks as one that settled there directly.

const PHOTO = fixtureAssetId('photo');
/** Tiled: past the 4096 level, 256 px tiles. */
const HUGE: FixtureAssetSpec = { naturalSize: { width: 8000, height: 6000 } };
/** Small, so the fixture renders it quickly: levels 128, 512 and the 1000 px original. */
const SMALL: FixtureAssetSpec = { naturalSize: { width: 1000, height: 666 } };

/**
 * A harness over the fixture source with its assets listed.
 *
 * @param assets - The assets.
 * @param settings - The harness settings.
 * @returns The harness.
 */
function harnessWith(
  assets: Readonly<Record<string, FixtureAssetSpec>>,
  settings: HarnessSettings = {},
): TextureManagerHarness {
  return new TextureManagerHarness(createFixtureAssetSource(5, { assets }), settings);
}

/**
 * What each image the camera shows draws, by id.
 *
 * @param harness - The harness.
 * @param images - The images.
 * @param camera - The camera.
 * @returns The shown keys of the images on screen.
 */
function shownOnScreen(
  harness: TextureManagerHarness,
  images: readonly ImageObject[],
  camera: Camera,
): Record<string, string[]> {
  const viewport = visibleWorldBounds(camera);
  const onScreen = images.filter((image) =>
    intersectsBounds(
      { minX: image.x, minY: image.y, maxX: image.x + image.width, maxY: image.y + image.height },
      viewport,
    ),
  );
  return Object.fromEntries(
    onScreen.map((image) => [image.id, harness.manager.shownKeys(image.id)]),
  );
}

describe('TextureManager pans', () => {
  it('gives a near tiled image panned on screen its tiles once the camera rests', async () => {
    // Zoom 16: the view is 62.5 world units wide. At x = 70 the image is just off screen, in the
    // padded view (near); a pan to x = 10 brings its left edge on screen.
    const image = imageObject({ x: 70, width: 800, height: 600, naturalSize: HUGE.naturalSize });
    const panned = harnessWith({ [PHOTO]: HUGE });
    panned.track(image);
    await panned.settle(cameraAt(16, 0));
    await panned.settle(cameraAt(16, 10));
    const direct = harnessWith({ [PHOTO]: HUGE });
    direct.track(image);
    await direct.settle(cameraAt(16, 10));

    const shown = panned.manager.shownKeys(image.id);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((key) => key.includes('|T'))).toBe(true);
    expect(shown).toEqual(direct.manager.shownKeys(image.id));
  });

  it('plans once when the camera comes to rest after a pan that planned nothing', async () => {
    const images = [0, 450].map((x, index) =>
      imageObject({
        id: `image-${String(index)}` as ObjectId,
        assetId: PHOTO,
        x,
        naturalSize: SMALL.naturalSize,
      }),
    );
    const harness = harnessWith({ [PHOTO]: SMALL });
    harness.track(...images);
    await harness.settle(cameraAt(1, 0));
    const plan = vi.spyOn(ImagePlanner.prototype, 'plan');

    harness.frame(cameraAt(1, 50));
    expect(plan).toHaveBeenCalledTimes(0);
    harness.frame(cameraAt(1, 50));
    harness.frame(cameraAt(1, 50));

    expect(plan).toHaveBeenCalledTimes(1);
    plan.mockRestore();
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'ends a pan at rest in the picks of settling there directly (seed %i)',
    async (seed) => {
      const random = seededRandom(seed);
      const zoom = [0.5, 1, 2, 4][Math.floor(random() * 4)] ?? 1;
      const width = 1000 / zoom;
      const assets: Record<string, FixtureAssetSpec> = {};
      const images: ImageObject[] = [];
      // Small images round and just beyond the start view, and on every other board a tiled
      // one just right of it (near), five views wide: past its largest level, so tiled.
      const count = 6 + Math.floor(random() * 8);
      for (let index = 0; index < count; index += 1) {
        const isHuge = index === 0 && seed % 2 === 0;
        const assetKey = isHuge ? 'huge' : `photo-${String(index % 4)}`;
        const spec = isHuge ? HUGE : SMALL;
        assets[assetKey] = spec;
        const side = (isHuge ? 5 : 0.05 + random() * 0.3) * width;
        images.push(
          imageObject({
            id: `image-${String(index)}` as ObjectId,
            assetId: fixtureAssetId(assetKey),
            x: (isHuge ? 1.01 + random() * 0.1 : random() * 1.6 - 0.3) * width,
            y: (random() * 1.6 - 0.3) * width * 0.8,
            width: side,
            height: side * 0.666,
            naturalSize: spec.naturalSize,
          }),
        );
      }
      let camera = cameraAt(zoom, 0, 0);
      const settings: HarnessSettings = { maxTextureSize: 2048 };
      const panned = harnessWith(assets, settings);
      panned.track(...images);
      await panned.settle(camera, 80);
      // A steady pan, mostly rightwards, a random number of frames: it stays inside the padded
      // search (a quarter view), so after its first frame the finder takes every frame (`pan`).
      const steps = 3 + Math.floor(random() * 10);
      const stepX = (0.01 + random() * 0.01) * width;
      const stepY = (random() - 0.5) * 0.01 * width;
      for (let step = 0; step < steps; step += 1) {
        camera = cameraAt(zoom, camera.x + stepX, camera.y + stepY);
        panned.frame(camera);
      }
      await panned.settle(camera, 80);
      const direct = harnessWith(assets, settings);
      direct.track(...images);
      await direct.settle(camera, 80);

      expect(shownOnScreen(panned, images, camera)).toEqual(shownOnScreen(direct, images, camera));
    },
  );

  it('plans at most one frame in 25 of a drag whose speed varies, over a board wider than the view', async () => {
    // 4000 images, 1000 on screen; 400 frames of 2 to 6 world units each. A frame plans when the
    // view leaves the padded search (every quarter view, 250 world units) or the prefetch
    // region moves (the speed doubles or falls to a quarter): not on every change of speed.
    const harness = await settledWideBoard(160);
    const plan = vi.spyOn(ImagePlanner.prototype, 'plan');
    const drag = varyingDrag(400);

    for (const camera of drag) harness.frame(camera);

    expect(plan.mock.calls.length).toBeLessThanOrEqual(drag.length / 25);
    plan.mockRestore();
  });
});
