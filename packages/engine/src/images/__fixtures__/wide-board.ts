// A board wider than the view and a drag across it whose speed varies from frame to frame: the
// texture manager's drag benchmark and the test that bounds how often such a drag plans.
import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { seededRandom } from '../../spatial/__fixtures__/random-boxes.js';
import { createFixtureAssetSource, fixtureAssetId } from '../fixture-asset-source.js';

import { imageObject } from './image-objects.js';
import { cameraAt, TextureManagerHarness } from './texture-manager-harness.js';

/** Distinct assets: images share them, as photos on a real board repeat less but still share. */
const ASSET_COUNT = 97;
const NATURAL_SIZE = { width: 1600, height: 1200 };
/** Grid spacing, world units: 40 columns and 25 rows fill the 1000 × 800 view at zoom 1. */
const COLUMN_STEP = 25;
const ROW_STEP = 32;
const ROWS = 25;

/** The slowest and fastest drag, world units a frame (at zoom 1, CSS px a frame). */
export const DRAG_STEP_RANGE = { min: 2, max: 6 } as const;

/**
 * A manager tracking a grid of 20 × 15 world-unit images, 25 rows of `columns`, settled at zoom
 * 1 looking at its left end: 1000 on screen, the rest to the right.
 *
 * @param columns - Images per row: 160 makes 4000 images, four views wide.
 * @returns The harness.
 */
export async function settledWideBoard(columns: number): Promise<TextureManagerHarness> {
  const assets = Object.fromEntries(
    Array.from({ length: ASSET_COUNT }, (unused, index) => [
      `asset-${String(index)}`,
      { naturalSize: NATURAL_SIZE },
    ]),
  );
  const harness = new TextureManagerHarness(createFixtureAssetSource(3, { assets }));
  harness.track(
    ...Array.from({ length: columns * ROWS }, (unused, index) =>
      imageObject({
        id: `image-${String(index)}` as ObjectId,
        assetId: fixtureAssetId(`asset-${String(index % ASSET_COUNT)}`),
        x: (index % columns) * COLUMN_STEP,
        y: Math.floor(index / columns) * ROW_STEP,
        width: 20,
        height: 15,
        naturalSize: NATURAL_SIZE,
      }),
    ),
  );
  await harness.settle(cameraAt(1), 60);
  return harness;
}

/**
 * The cameras of a drag to the right at zoom 1 from the board's left end, each frame's step
 * drawn afresh between {@link DRAG_STEP_RANGE}'s bounds: a hand whose speed varies. Seeded.
 *
 * @param frames - How many frames.
 * @param seed - The seed.
 * @returns One camera per frame.
 */
export function varyingDrag(frames: number, seed = 11): Camera[] {
  const random = seededRandom(seed);
  const cameras: Camera[] = [];
  let x = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    x += DRAG_STEP_RANGE.min + random() * (DRAG_STEP_RANGE.max - DRAG_STEP_RANGE.min);
    cameras.push(cameraAt(1, x, 0));
  }
  return cameras;
}
