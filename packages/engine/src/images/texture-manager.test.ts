import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { FetchGate } from './__fixtures__/fetch-gate.js';
import { imageObject } from './__fixtures__/image-objects.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import {
  createFixtureAssetSource,
  fixtureAssetId,
  type FixtureAssetOptions,
} from './fixture-asset-source.js';

const MIB = 1024 * 1024;
const PHOTO = fixtureAssetId('photo');
const PHOTO_SPEC = { naturalSize: { width: 4000, height: 3000 } };

function harnessFor(
  options: FixtureAssetOptions,
  settings: { texturesBytes?: number; maxTextureSize?: number } = {},
): TextureManagerHarness {
  return new TextureManagerHarness(createFixtureAssetSource(5, options), settings);
}

function idOf(name: string): ObjectId {
  return name as ObjectId;
}

describe('TextureManager levels', () => {
  it('draws a grey placeholder until described, then the level the zoom needs', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    const image = imageObject();
    harness.track(image);

    const first = harness.frame(cameraAt(1));
    await harness.settle(cameraAt(1));

    expect(first.blankImages).toBe(0);
    expect(harness.manager.bindingOf(image.id).parts).toHaveLength(1);
    // 400 CSS px on screen at DPR 1: the 512 level.
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
    expect(harness.manager.residentKeys()).toEqual(['photo|L128', 'photo|L512']);
  });

  it('asks for no frame when a level fails, and fetches it again once its wait is over', async () => {
    let failures = 1;
    const harness = harnessFor({
      assets: { [PHOTO]: PHOTO_SPEC },
      beforeFetch: (request) =>
        request.longEdgePx === 512 && (failures -= 1) >= 0
          ? Promise.reject(new Error('404: not linked to this board yet'))
          : Promise.resolve(),
    });
    const image = imageObject();
    harness.track(image);

    await harness.settle(cameraAt(1));
    const shownWhileFailed = harness.manager.shownKeys(image.id);
    const requestsWhileWaiting = harness.frameRequests;
    harness.retries.shift()?.();
    const requestsWhenDue = harness.frameRequests;
    await harness.settle(cameraAt(1));

    expect(shownWhileFailed).toEqual(['photo|L128']);
    expect([requestsWhileWaiting, requestsWhenDue]).toEqual([0, 1]);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
  });

  it('asks for no frame once destroyed: its retry waits stop with it', async () => {
    const harness = harnessFor({
      assets: { [PHOTO]: PHOTO_SPEC },
      beforeFetch: (request) =>
        request.longEdgePx === 512
          ? Promise.reject(new Error('404: not linked to this board yet'))
          : Promise.resolve(),
    });
    harness.track(imageObject());
    await harness.settle(cameraAt(1));
    expect(harness.retries).toHaveLength(1);

    harness.manager.destroy();
    for (const callback of harness.retries.splice(0)) callback();

    expect(harness.frameRequests).toBe(0);
  });

  it('cancels the loads of an image the view left, and every load when destroyed', async () => {
    const gate = new FetchGate(['level 512']);
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC }, beforeFetch: gate.beforeFetch });
    const image = imageObject();
    harness.track(image);
    harness.frame(cameraAt(1));
    await harness.jobs.settle();
    // Described now: this frame asks for the 512 level, which the gate holds back.
    harness.frame(cameraAt(1));
    await harness.jobs.settle();
    const isLoadingOnScreen = harness.manager.isLoading;

    harness.frame(cameraAt(1, 100_000, 100_000));
    const isLoadingAway = harness.manager.isLoading;
    harness.frame(cameraAt(1));
    harness.manager.forget(idOf('never-tracked'));
    harness.manager.destroy();

    expect([isLoadingOnScreen, isLoadingAway, harness.manager.isLoading]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('picks the level for the device pixels, so DPR 2 needs twice the level', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    const image = imageObject();
    harness.track(image);

    await harness.settle(cameraAt(1, 0, 0, 2));

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L2048']);
  });

  it('shows the smallest level while a larger one loads, and never a blank frame', async () => {
    const gate = new FetchGate(['level 2048']);
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC }, beforeFetch: gate.beforeFetch });
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(0.25));
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L128']);

    // Zooming in fast: 400 px at zoom 4 needs 1600 px, the 2048 level, which is held back.
    const zoomedIn = [];
    for (let frame = 0; frame < 5; frame += 1) {
      zoomedIn.push(harness.frame(cameraAt(4)).blankImages);
      await harness.jobs.settle();
    }
    expect(zoomedIn).toEqual([0, 0, 0, 0, 0]);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L128']);

    gate.open('level 2048');
    const after = await harness.settle(cameraAt(4));

    expect(after.every(({ blankImages }) => blankImages === 0)).toBe(true);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L2048']);
    expect(harness.manager.stats.blankImageFrames).toBe(0);
  });

  it('keeps its level while the zoom wobbles inside the hysteresis band', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(1.25));
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);

    // 400 × 1.35 = 540 px is over 512 but within its 10% slack.
    await harness.settle(cameraAt(1.35));

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
  });

  it('resizes the original in one job while the server levels are pending, then uses them', async () => {
    const source = createFixtureAssetSource(5, {
      assets: { [PHOTO]: { ...PHOTO_SPEC, hasServerLevels: false } },
    });
    const harness = new TextureManagerHarness(source);
    const image = imageObject();
    harness.track(image);

    await harness.settle(cameraAt(1));
    source.publishLevels(PHOTO);
    await harness.settle(cameraAt(4));

    expect(harness.jobs.submitted.map(({ longEdgesPx }) => longEdgesPx)).toEqual([
      [128, 512],
      [2048],
    ]);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L2048']);
  });
});

describe('TextureManager residency', () => {
  it('packs the small images of a board onto one atlas page', async () => {
    const assets = Object.fromEntries(
      Array.from({ length: 20 }, (unused, index) => [
        `small-${String(index)}`,
        { naturalSize: { width: 200, height: 150 } },
      ]),
    );
    const harness = harnessFor({ assets });
    const images = Object.keys(assets).map((assetId, index) =>
      imageObject({
        id: idOf(`image-${String(index)}`),
        assetId: fixtureAssetId(assetId),
        x: (index % 5) * 200,
        y: Math.floor(index / 5) * 150,
        width: 200,
        height: 150,
        naturalSize: { width: 200, height: 150 },
      }),
    );
    harness.track(...images);

    await harness.settle(cameraAt(1));

    const labels = harness.backend.liveTextures().map(({ label }) => label);
    expect(labels).toEqual(['image placeholder', 'image atlas 0']);
    expect(images.every((image) => harness.manager.shownKeys(image.id)[0]?.endsWith('|L200'))).toBe(
      true,
    );
  });

  it('evicts the larger idle level first under a tiny budget, and never exceeds it', async () => {
    const assets = Object.fromEntries(['a', 'b', 'c'].map((name) => [name, PHOTO_SPEC]));
    // Atlas pages of 2048² (16 MiB) hold the 128 levels; 40 MiB leaves room for one 2048 level
    // (12 MiB) and one 512 level beside them, not two 2048 levels.
    const harness = harnessFor({ assets }, { texturesBytes: 40 * MIB, maxTextureSize: 2048 });
    const [a, b, c] = ['a', 'b', 'c'].map((name, index) =>
      imageObject({ id: idOf(name), assetId: fixtureAssetId(name), x: index * 5000 }),
    );
    if (a === undefined || b === undefined || c === undefined) throw new Error('no images');
    harness.track(a, b, c);
    const budgets: number[] = [];

    for (const camera of [cameraAt(1, 5000), cameraAt(4, 0), cameraAt(4, 10_000)]) {
      for (const result of await harness.settle(camera)) {
        expect(result.blankImages).toBe(0);
        budgets.push(harness.ledger.bytesOf('textures'));
      }
    }

    // b's 512 was used before a's 2048, but the larger idle level goes first.
    expect(harness.manager.shownKeys(c.id)).toEqual(['c|L2048']);
    expect(harness.manager.stats.evictions).toBe(1);
    expect(harness.manager.shownKeys(a.id)).toEqual(['a|L128']);
    expect(harness.manager.shownKeys(b.id)).toEqual(['b|L512']);
    expect(Math.max(...budgets)).toBeLessThanOrEqual(40 * MIB);
  });

  it('draws only the visible tiles of a large image, from the level until each tile arrives', async () => {
    const gate = new FetchGate(['tile 0']);
    const huge = { naturalSize: { width: 8000, height: 6000 } };
    const harness = harnessFor({ assets: { [PHOTO]: huge }, beforeFetch: gate.beforeFetch });
    const image = imageObject({ width: 800, height: 600, naturalSize: huge.naturalSize });
    harness.track(image);

    // Zoom 16: 800 px wide on the board is 12 800 px on screen, past the 4096 level; the view
    // (62.5 × 50 world units) shows the top-left 625 × 500 px of the original: 3 × 2 tiles.
    await harness.settle(cameraAt(16));
    expect(harness.manager.shownKeys(image.id)).toEqual(
      Array.from({ length: 6 }, () => 'photo|L4096'),
    );

    gate.open('tile 0');
    await harness.settle(cameraAt(16));

    expect(harness.manager.shownKeys(image.id)).toEqual([
      'photo|T0/0/0',
      'photo|T0/1/0',
      'photo|T0/2/0',
      'photo|T0/0/1',
      'photo|T0/1/1',
      'photo|T0/2/1',
    ]);
  });

  it('prefetches the images the pan is heading for', async () => {
    const assets = { [PHOTO]: PHOTO_SPEC, ahead: PHOTO_SPEC };
    const harness = harnessFor({ assets });
    const here = imageObject();
    const ahead = imageObject({ id: idOf('ahead'), assetId: fixtureAssetId('ahead'), x: 2000 });
    harness.track(here, ahead);
    await harness.settle(cameraAt(1));

    harness.frame(cameraAt(1, 50));
    await harness.jobs.settle();

    const aheadJobs = harness.jobs.submitted.filter(({ assetId }) => assetId === 'ahead');
    expect(aheadJobs.map(({ priority }) => priority)).toContain('prefetch');
  });
});

describe('TextureManager failures', () => {
  it('starts a new manager after a device loss at the smallest levels, without a blank frame', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(1));
    const jobsBefore = harness.jobs.submitted.length;

    const fresh = new FakeGpuBackend();
    harness.backend.loseDevice();
    harness.rebuild(fresh);
    harness.track(image);
    const first = harness.frame(cameraAt(1));

    expect(first.blankImages).toBe(0);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L128']);
    expect(fresh.liveTextures().map(({ label }) => label)).toEqual([
      'image placeholder',
      'image atlas 0',
    ]);
    await harness.jobs.settle();
    await harness.settle(cameraAt(1));
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
    // Only the 512 level was fetched again; the 128 came from its CPU copy.
    expect(harness.jobs.submitted.slice(jobsBefore).map(({ longEdgesPx }) => longEdgesPx)).toEqual([
      [512],
    ]);
  });

  it('still counts an image blank after a loss when its CPU copy was dropped by the cap', async () => {
    const assets = { a: PHOTO_SPEC, b: PHOTO_SPEC };
    // Room for one 128 × 96 copy: keeping b's drops a's.
    const harness = new TextureManagerHarness(createFixtureAssetSource(5, { assets }), {
      maxCopyBytes: 128 * 96 * 4,
    });
    const images = ['a', 'b'].map((name, index) =>
      imageObject({ id: idOf(name), assetId: fixtureAssetId(name), x: index * 450 }),
    );
    harness.track(...images);
    await harness.settle(cameraAt(0.25));

    harness.backend.loseDevice();
    harness.rebuild(new FakeGpuBackend());
    harness.track(...images);
    const first = harness.frame(cameraAt(0.25));

    // a's pixels are gone until it loads again: blank, not hidden as never ready.
    expect(first).toMatchObject({ blankImages: 1, placeholderImages: 0, visibleImages: 2 });
  });

  it('counts images that never loaded as placeholders, apart from blank ones', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    harness.track(imageObject());

    const first = harness.frame(cameraAt(1));
    const settled = (await harness.settle(cameraAt(1))).at(-1);

    expect(first).toMatchObject({ blankImages: 0, placeholderImages: 1, visibleImages: 1 });
    expect(settled).toMatchObject({ blankImages: 0, placeholderImages: 0, visibleImages: 1 });
  });

  it('drops to a lower level when the GPU cannot allocate a texture', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    // The placeholder and the atlas page fit; a texture of its own for the 512 level does not.
    harness.backend.maxLiveTextures = 2;
    const image = imageObject();
    harness.track(image);

    const results = await harness.settle(cameraAt(1));

    expect(harness.manager.stats.allocationFailures).toBeGreaterThanOrEqual(1);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L128']);
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('forgets an image the scene removed', async () => {
    const harness = harnessFor({ assets: { [PHOTO]: PHOTO_SPEC } });
    const image = imageObject();
    harness.track(image);
    await harness.settle(cameraAt(1));

    harness.manager.forget(image.id);

    expect(harness.manager.shownKeys(image.id)).toEqual(['placeholder']);
  });
});
