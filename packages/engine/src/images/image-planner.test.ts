import { describe, expect, it } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { JobPriority } from '../workers/job-priority.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { showableLevels } from './asset-catalogue.js';
import type { ImageAssetInfo } from './asset-source.js';
import { ImageIndex, type TrackedImage } from './image-index.js';
import {
  assetView,
  MAX_TILE_PARTS,
  type AssetView,
  type ImageCandidate,
  type NeedsInput,
  type ObjectPlan,
  levelKey,
  parseLevelKey,
  tileKey,
} from './image-needs.js';
import { ImagePlanner, planImageNeeds } from './image-planner.js';

const MIB = 1024 * 1024;
const PHOTO = 'photo' as AssetId;
const OTHER = 'other' as AssetId;
const HUGE = 'huge' as AssetId;
const EVERYWHERE: WorldBounds = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

/**
 * A described asset as the planner sees it: its server levels below its long edge, tiled over
 * 4096 px as the assets service tiles.
 *
 * @param assetId - The asset.
 * @param width - Its natural width, px.
 * @param height - Its natural height, px.
 * @returns Its view.
 */
function viewOf(assetId: AssetId, width: number, height: number): AssetView {
  const isTiled = Math.max(width, height) > 4096;
  const info: ImageAssetInfo = {
    mimeType: 'image/png',
    naturalSize: { width, height },
    levels: [128, 512, 2048, 4096]
      .filter((edge) => edge < Math.max(width, height))
      .map((longEdgePx) => ({ longEdgePx, format: 'webp' as const })),
    tiles: isTiled ? { tileSizePx: 256, levels: 2, format: 'webp' } : null,
    averageColor: null,
    blurhash: null,
  };
  const naturalSize = { width, height };
  return assetView(assetId, info, naturalSize, showableLevels(naturalSize, info, 8192));
}

const FLAT = 'flat' as AssetId;
const ONE_TILE_LEVEL = 'one-tile-level' as AssetId;

/**
 * A tiled asset whose pyramid has only its full-resolution level, 32 × 24 tiles: more than
 * {@link MAX_TILE_PARTS} whenever most of it is visible.
 *
 * @returns Its view.
 */
function oneTileLevelView(): AssetView {
  const view = viewOf(ONE_TILE_LEVEL, 8000, 6000);
  const tiles = { tileSizePx: 256 as const, levels: 1, format: 'webp' as const };
  return { ...view, info: { ...view.info, tiles } };
}

const VIEWS = new Map<AssetId, AssetView>([
  [PHOTO, viewOf(PHOTO, 4000, 3000)],
  [OTHER, viewOf(OTHER, 4000, 3000)],
  [HUGE, viewOf(HUGE, 8000, 6000)],
  [FLAT, viewOf(FLAT, 3000, 2000)],
  [ONE_TILE_LEVEL, oneTileLevelView()],
]);

/**
 * A 400 × 300 image of an asset, tracked at the origin.
 *
 * @param id - The object.
 * @param assetId - Its asset.
 * @returns The tracked image.
 * @throws {Error} Never: the object is an image.
 */
function trackedImage(id: string, assetId: AssetId): TrackedImage {
  const object = imageObject({ id: id as ObjectId, assetId });
  const tracked = new ImageIndex().track({ object, transform: { cos: 1, sin: 0, x: 0, y: 0 } });
  if (tracked === undefined) throw new Error('not an image');
  return tracked;
}

/**
 * The planner's input with test defaults: zoom 1 at DPR 1, the whole world visible, a large
 * budget and no previous plans.
 *
 * @param candidates - The candidates, as image and priority.
 * @param overrides - Fields to change.
 * @returns The input.
 */
function inputOf(
  candidates: readonly [TrackedImage, JobPriority][],
  overrides: Partial<NeedsInput> = {},
): NeedsInput {
  return {
    candidates: candidates.map(([image, priority]): ImageCandidate => ({ image, priority })),
    assetOf: (assetId) => VIEWS.get(assetId),
    previousPlan: () => undefined,
    zoom: 1,
    dpr: 1,
    viewport: EVERYWHERE,
    budgetBytes: 512 * MIB,
    ...overrides,
  };
}

describe('planImageNeeds', () => {
  it("wants each image's smallest level and the level its size on screen needs", () => {
    const image = trackedImage('a', PHOTO);

    const { wants, plans } = planImageNeeds(inputOf([[image, 'visible']]));

    expect([...wants.keys()]).toEqual(['photo|L128', 'photo|L512']);
    expect(wants.get('photo|L512')).toMatchObject({ priority: 'visible', isNeeded: true });
    expect(wants.get('photo|L512')?.source).toEqual({
      kind: 'server',
      assetId: PHOTO,
      longEdgePx: 512,
    });
    expect(plans.get(image.object.id)).toMatchObject({ level: 512, pickedLevel: 512 });
  });

  it('asks once for a level two images share, at the most urgent priority and need', () => {
    const ahead = trackedImage('ahead', PHOTO);
    const onScreen = trackedImage('on-screen', PHOTO);

    const { wants } = planImageNeeds(
      inputOf([
        [ahead, 'prefetch'],
        [onScreen, 'visible'],
      ]),
    );
    const prefetchOnly = planImageNeeds(inputOf([[ahead, 'prefetch']])).wants;

    expect(wants.get('photo|L128')).toMatchObject({ priority: 'visible', isNeeded: true });
    expect(prefetchOnly.get('photo|L128')).toMatchObject({ priority: 'prefetch', isNeeded: false });
  });

  it('lowers the levels where the picks together would not fit the budget', () => {
    const first = trackedImage('first', PHOTO);
    const second = trackedImage('second', OTHER);
    // At 4× each image needs 1600 px: the 2048 levels, 18 MiB each.
    const input = inputOf(
      [
        [first, 'visible'],
        [second, 'visible'],
      ],
      { zoom: 4, budgetBytes: 20 * MIB },
    );

    const { plans } = planImageNeeds(input);

    const levels = [first, second].map(({ object }) => plans.get(object.id)?.level);
    expect(levels.sort()).toEqual([2048, 512]);
    // The picked level is kept for hysteresis, whatever the budget allowed.
    expect(plans.get(first.object.id)?.pickedLevel).toBe(2048);
  });

  it("returns last frame's plan when nothing about the image changed", () => {
    const image = trackedImage('a', PHOTO);
    const first = planImageNeeds(inputOf([[image, 'visible']])).plans.get(image.object.id);
    const previous = (id: ObjectId): ObjectPlan | undefined =>
      id === image.object.id ? first : undefined;

    const second = planImageNeeds(inputOf([[image, 'visible']], { previousPlan: previous }));

    expect(second.plans.get(image.object.id)).toBe(first);
  });

  it('wants only the visible tiles of a tiled image zoomed past its largest level', () => {
    const image = trackedImage('a', HUGE);
    // At 16× the 400 px box needs 6400 px; a 100-unit corner of the box is on screen.
    const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

    const { wants, plans } = planImageNeeds(inputOf([[image, 'visible']], { zoom: 16, viewport }));

    const tiles = plans.get(image.object.id)?.tiles ?? [];
    // The visible quarter by third is 2000 × 2000 px of the original: 8 × 8 of its 32 × 24 tiles.
    expect(tiles).toHaveLength(64);
    expect(tiles.every(({ address }) => address.level === 1)).toBe(true);
    const tileWant = wants.get(tiles[0]?.key ?? '');
    expect(tileWant?.source.kind).toBe('tile');
  });

  it('shows the largest level of an untiled image zoomed past it, with no tiles', () => {
    const image = trackedImage('a', FLAT);

    const { plans } = planImageNeeds(inputOf([[image, 'visible']], { zoom: 16 }));

    expect(plans.get(image.object.id)).toMatchObject({ level: 3000, tiles: undefined });
  });

  it('asks for no tiles of a tiled image that is not on screen after all', () => {
    const image = trackedImage('a', HUGE);
    const viewport = { minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 };

    const { plans } = planImageNeeds(inputOf([[image, 'visible']], { zoom: 16, viewport }));

    expect(plans.get(image.object.id)?.tiles).toBeUndefined();
  });

  it('shows a level when even the coarsest tile level would need too many tiles', () => {
    const image = trackedImage('a', ONE_TILE_LEVEL);

    const { plans } = planImageNeeds(inputOf([[image, 'visible']], { zoom: 16 }));

    expect(32 * 24).toBeGreaterThan(MAX_TILE_PARTS);
    expect(plans.get(image.object.id)).toMatchObject({ level: 4096, tiles: undefined });
  });

  it('asks once for a tile two images of one asset show', () => {
    const first = trackedImage('first', HUGE);
    const second = trackedImage('second', HUGE);
    const viewport = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

    const { wants, plans } = planImageNeeds(
      inputOf(
        [
          [first, 'visible'],
          [second, 'visible'],
        ],
        { zoom: 16, viewport },
      ),
    );

    const tileWants = [...wants.values()].filter(({ source }) => source.kind === 'tile');
    expect(tileWants).toHaveLength(plans.get(first.object.id)?.tiles?.length ?? -1);
  });

  it('fits the budget per asset: the largest pick of its images, others skipped', () => {
    const large = trackedImage('large', PHOTO);
    const small = trackedImage('small', PHOTO);
    const unknown = trackedImage('unknown', 'unknown' as AssetId);
    const smallObject = { ...small.object, width: 40, height: 30 };
    const input = inputOf(
      [
        [large, 'visible'],
        [{ ...small, object: smallObject }, 'visible'],
        [unknown, 'visible'],
      ],
      { zoom: 4, budgetBytes: 12.5 * MIB },
    );

    const { plans } = planImageNeeds(input);

    // Counted per image the picks (12 MiB at 2048, 0.75 at 512) would not fit; per asset they do.
    expect(plans.get(large.object.id)?.level).toBe(2048);
    expect(plans.get(small.object.id)?.level).toBe(512);
    expect(plans.has(unknown.object.id)).toBe(false);
  });

  it('plans nothing for an image whose asset is not described yet', () => {
    const image = trackedImage('a', 'unknown' as AssetId);

    const { wants, plans } = planImageNeeds(inputOf([[image, 'visible']]));

    expect(wants.size).toBe(0);
    expect(plans.size).toBe(0);
  });
});

describe('ImagePlanner', () => {
  it('keeps its wants and plans between plans: the same objects, and only changes listed', () => {
    const planner = new ImagePlanner();
    const first = trackedImage('first', PHOTO);
    const second = trackedImage('second', OTHER);
    const both = inputOf([
      [first, 'visible'],
      [second, 'visible'],
    ]);
    planner.plan(both);
    const want = planner.wants.get('photo|L512');
    const plan = planner.planOf(first.object.id);
    expect(planner.changed).toEqual([first.object.id, second.object.id]);

    planner.plan({ ...both, zoom: 1.05 });

    expect(planner.wants.get('photo|L512')).toBe(want);
    expect(planner.planOf(first.object.id)).toBe(plan);
    expect(planner.changed).toEqual([]);
  });

  it('drops the wants and plans of images that are no longer candidates', () => {
    const planner = new ImagePlanner();
    const first = trackedImage('first', PHOTO);
    const second = trackedImage('second', OTHER);
    planner.plan(
      inputOf([
        [first, 'visible'],
        [second, 'near'],
      ]),
    );

    planner.plan(inputOf([[first, 'prefetch']]));

    expect([...planner.wants.keys()]).toEqual(['photo|L128', 'photo|L512']);
    expect(planner.wants.get('photo|L128')).toMatchObject({
      priority: 'prefetch',
      isNeeded: false,
    });
    expect(planner.planOf(second.object.id)).toBeUndefined();
  });

  it("stops wanting a tiled image's largest level once its visible tiles are resident", () => {
    const planner = new ImagePlanner();
    const image = trackedImage('a', HUGE);
    const viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const input = inputOf([[image, 'visible']], { zoom: 16, viewport });
    planner.plan(input);
    const tiles = planner.planOf(image.object.id)?.tiles ?? [];
    expect(tiles.length).toBeGreaterThan(0);
    expect(planner.wants.has('huge|L4096')).toBe(true);

    const resident = new Set(tiles.map(({ key }) => key));
    planner.plan({ ...input, isResident: (key) => resident.has(key) });

    expect(planner.wants.has('huge|L4096')).toBe(false);
    expect(planner.wants.has('huge|L128')).toBe(true);
  });

  it('keeps the largest resident level below one that is not resident wanted, as it is shown', () => {
    const image = trackedImage('a', PHOTO);
    const resident = new Set(['photo|L128', 'photo|L512', 'photo|L2048']);
    // Zoom 8: 3200 px on screen, the 4000 px original, which is not resident (loading, or
    // waiting for room): the 2048 level it shows meanwhile stays needed.
    const input = inputOf([[image, 'visible']], {
      zoom: 8,
      isResident: (key) => resident.has(key),
    });

    const waiting = planImageNeeds(input);
    resident.add('photo|L4000');
    const arrived = planImageNeeds(input);

    expect([...waiting.wants.keys()]).toEqual(['photo|L128', 'photo|L4000', 'photo|L2048']);
    expect(waiting.wants.get('photo|L2048')).toMatchObject({ isNeeded: true });
    expect([...arrived.wants.keys()]).toEqual(['photo|L128', 'photo|L4000']);
  });

  it('counts the candidates that may show tiles, at any priority', () => {
    const planner = new ImagePlanner();
    const image = trackedImage('a', HUGE);
    const viewport = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

    // Near, zoomed past its largest level: no tiles yet, but a pan may bring it on screen.
    planner.plan(inputOf([[image, 'near']], { zoom: 16, viewport }));
    expect(planner.planOf(image.object.id)?.tiles).toBeUndefined();
    expect(planner.hasTileCandidates).toBe(true);

    planner.plan(inputOf([[image, 'visible']], { zoom: 0.5, viewport }));
    expect(planner.hasTileCandidates).toBe(false);
    planner.plan(inputOf([[image, 'prefetch']], { zoom: 16, viewport }));
    expect(planner.hasTileCandidates).toBe(true);
    planner.forget(image.object.id);
    planner.forget('never planned' as ObjectId);
    planner.plan(inputOf([]));

    expect(planner.hasTileCandidates).toBe(false);
    expect(planner.wants.size).toBe(0);
  });
});

describe('parseLevelKey', () => {
  it('reads a level key back, and nothing from a tile key or another string', () => {
    expect(parseLevelKey(levelKey(PHOTO, 1000))).toEqual({ assetId: PHOTO, longEdgePx: 1000 });
    expect(parseLevelKey(tileKey(PHOTO, { level: 0, column: 1, row: 2 }))).toBeUndefined();
    expect(parseLevelKey('placeholder')).toBeUndefined();
  });
});
