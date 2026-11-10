import { bench, describe } from 'vitest';

import {
  createObjectsCommand,
  runCommand,
  YjsDocumentStore,
  type CommandEnvironment,
} from '@canvas/document';
import type { AssetId, ObjectId } from '@canvas/schema';

import { ADA, NOW } from '../select/__fixtures__/select-store.js';

import { placeImages, type PlacedImage } from './image-placement.js';

// The image-heavy board of the memory benchmark (tooling/bench's `image-heavy`: 200
// large images, every tenth 8000 × 6000 px and the rest 4000 × 3000) inserted once through the
// tool path: `placeImages`, as a drop, paste or pick places them, then the one
// `createObjects` command that creates them all, on an empty board. What a drop of 200 photos
// costs the page before any upload starts. Gated by `pnpm bench:ci` like every package's
// `*.bench.ts`.

/** The image-heavy board's images: 200 assets, every tenth one tiled. */
const IMAGES: PlacedImage[] = Array.from({ length: 200 }, (unused, index) => ({
  assetId: `image-${String(index).padStart(3, '0')}` as AssetId,
  naturalSize: index % 10 === 0 ? { width: 8000, height: 6000 } : { width: 4000, height: 3000 },
}));

/**
 * A command environment numbering new ids.
 *
 * @returns The environment.
 */
function environment(): CommandEnvironment {
  let next = 0;
  return { clock: () => NOW, createId: () => `image-object-${String((next += 1))}` as ObjectId };
}

describe('inserting the image-heavy board through the tool path', () => {
  bench('placeImages and one createObjects of 200 large images', () => {
    const store = new YjsDocumentStore();
    const objects = placeImages(IMAGES, { x: 0, y: 0 });
    const outcome = runCommand(store, ADA, createObjectsCommand, { objects }, environment());
    if (outcome.status !== 'applied') throw new Error('The board refused the images.');
    store.destroy();
  });
});
