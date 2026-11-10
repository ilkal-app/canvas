import { bench, describe } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { imageObject } from './__fixtures__/image-objects.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import { settledWideBoard, varyingDrag } from './__fixtures__/wide-board.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';

// The texture manager's CPU cost per frame (the budget: camera-only frames under
// 1 ms of CPU) with 1k and 5k images on screen, their smallest levels resident, no load
// in flight. The budgets (the controller's ruling on) are stated in the names and gated by
// `pnpm bench:ci` (the micro-benchmark suite):
// - a pan at constant zoom: under 0.2 ms, at 1k and at 5k. No image changes level, so nothing
//   is planned (`CandidateFinder.pan`): priorities are updated in place and the visible images
//   counted. The pan moves half a world unit a frame and starts over every 2000 frames; when
//   the view leaves the padded search (every 250 world units), one frame searches and plans;
// - a zoom step: under 1 ms at 1k. Every candidate's level is picked again (on-screen size × DPR
//   with hysteresis) and its wants revived in place; nothing is allocated per image;
// - a still frame: nothing to plan;
// - a drag whose speed varies, over a board four views wide (4000 images, 1000 on screen): under
//   1 ms. Each frame moves 2 to 6 world units, drawn afresh (`varyingDrag`), so the images ahead
//   of the pan would change most frames; the prefetch region keeps its reach while the speed
//   varies (`prefetchReach`), and a frame plans only when the view leaves the padded search or
//   the reach moves (7 of 400; texture-manager-pan.test.ts bounds it at 1 in 25). The drag
//   starts over every 400 frames, which plans once.
// The images show 1600 × 1200 px assets (97 of them, so images share levels), on a grid filling
// the 1000 × 800 CSS px view at zoom 1.

const ASSET_COUNT = 97;
const NATURAL_SIZE = { width: 1600, height: 1200 };
/** Frames of a pan before it starts over. */
const PAN_FRAMES = 2000;

const assets = Object.fromEntries(
  Array.from({ length: ASSET_COUNT }, (unused, index) => [
    `asset-${String(index)}`,
    { naturalSize: NATURAL_SIZE },
  ]),
);

/**
 * A manager tracking a grid of 4:3 images filling the view, settled at zoom 1.
 *
 * @param columns - Images per row.
 * @param rows - Rows.
 * @returns The harness.
 */
async function settledGrid(columns: number, rows: number): Promise<TextureManagerHarness> {
  const across = 1000 / columns;
  const down = 800 / rows;
  const harness = new TextureManagerHarness(createFixtureAssetSource(3, { assets }));
  harness.track(
    ...Array.from({ length: columns * rows }, (unused, index) =>
      imageObject({
        id: `image-${String(index)}` as ObjectId,
        assetId: fixtureAssetId(`asset-${String(index % ASSET_COUNT)}`),
        x: (index % columns) * across,
        y: Math.floor(index / columns) * down,
        width: across * 0.8,
        height: across * 0.6,
        naturalSize: NATURAL_SIZE,
      }),
    ),
  );
  await harness.settle(cameraAt(1), 40);
  return harness;
}

/** Frames of the varying drag before it starts over. */
const DRAG_FRAMES = 400;

const thousand = await settledGrid(40, 25);
const fiveThousand = await settledGrid(100, 50);
const wide = await settledWideBoard(160);
const drag = varyingDrag(DRAG_FRAMES);

describe('TextureManager, 1000 visible images', () => {
  let panStep = 0;
  bench('a pan at constant zoom (budget < 0.2 ms)', () => {
    panStep = (panStep + 1) % PAN_FRAMES;
    thousand.frame(cameraAt(1, panStep * 0.5, 0));
  });

  let zoomStep = 0;
  bench('a zoom step (budget < 1 ms)', () => {
    // Steps of 1% about zoom 1, eight in and eight back out.
    zoomStep = (zoomStep + 1) % 16;
    const offset = zoomStep < 8 ? zoomStep : 16 - zoomStep;
    thousand.frame(cameraAt(1 + offset * 0.01, 0, 0));
  });

  bench('a still frame: nothing to plan', () => {
    thousand.frame(cameraAt(1, 0, 0));
  });
});

describe('TextureManager, 5000 visible images', () => {
  let panStep = 0;
  bench('a pan at constant zoom (budget < 0.2 ms)', () => {
    panStep = (panStep + 1) % PAN_FRAMES;
    fiveThousand.frame(cameraAt(1, panStep * 0.5, 0));
  });
});

describe('TextureManager, 4000 images four views wide, 1000 visible', () => {
  let dragStep = 0;
  bench('a drag whose speed varies, at constant zoom (budget < 1 ms)', () => {
    dragStep = (dragStep + 1) % DRAG_FRAMES;
    wide.frame(drag[dragStep] ?? cameraAt(1));
  });
});
