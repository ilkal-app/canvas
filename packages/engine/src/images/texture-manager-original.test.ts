import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FetchGate } from './__fixtures__/fetch-gate.js';
import { imageObject } from './__fixtures__/image-objects.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';

// The original as an untiled image's top level (the controller's ruling
// on): decoded in a job, only up to the texture limit and 4096 px, an ordinary level under
// the budget; a tiled image never decodes its original.

const MIB = 1024 * 1024;
const PHOTO = fixtureAssetId('photo');
/**
 * 1000 × 666: server levels 128 and 512; the original, 2.5 MiB, is the top level. Small, so the
 * fixture renders it quickly.
 */
const PHOTO_SPEC = { naturalSize: { width: 1000, height: 666 } };

function photoImage(id = 'image-1', assetId = PHOTO, x = 0) {
  return imageObject({
    id: id as ObjectId,
    assetId,
    x,
    width: 300,
    height: 200,
    naturalSize: PHOTO_SPEC.naturalSize,
  });
}

describe('TextureManager, the original as the top level', () => {
  it('decodes the original in a job when the view needs more than the largest server level', async () => {
    const gate = new FetchGate();
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, {
        assets: { [PHOTO]: PHOTO_SPEC },
        beforeFetch: gate.beforeFetch,
      }),
    );
    const image = photoImage();
    harness.track(image);

    // 300 px at zoom 4 needs 1200 px: more than 512, so the 1000 px original.
    await harness.settle(cameraAt(4));

    expect(gate.seen).toContain('original undefined');
    expect(harness.jobs.submitted.map(({ longEdgesPx }) => longEdgesPx)).toContainEqual([1000]);
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L1000']);
  });

  it('never shows an original larger than the texture limit', async () => {
    const gate = new FetchGate();
    const source = createFixtureAssetSource(5, {
      assets: { [PHOTO]: PHOTO_SPEC },
      beforeFetch: gate.beforeFetch,
    });
    const small = new TextureManagerHarness(source, { maxTextureSize: 512 });
    const image = photoImage();
    small.track(image);
    await small.settle(cameraAt(4));
    expect(small.manager.shownKeys(image.id)).toEqual(['photo|L512']);

    // The 4096 px limit on an untiled original is `showableLevels`' (asset-catalogue.test.ts).
    expect(gate.seen).not.toContain('original undefined');
  });

  it('evicts an idle original first when another image needs the room', async () => {
    const other = fixtureAssetId('other');
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC, [other]: PHOTO_SPEC } }),
      { texturesBytes: 20 * MIB },
    );
    const first = photoImage('first', PHOTO, 0);
    const second = photoImage('second', other, 10_000);
    harness.track(first, second);
    await harness.settle(cameraAt(4, 0));
    expect(harness.manager.shownKeys(first.id)).toEqual(['photo|L1000']);

    // The 128 atlas page (16 MiB) and two originals (2.5 MiB each) pass 20 MiB.
    await harness.settle(cameraAt(4, 10_000));

    expect(harness.manager.shownKeys(second.id)).toEqual(['other|L1000']);
    expect(harness.manager.residentKeys()).not.toContain('photo|L1000');
    expect(harness.ledger.bytesOf('textures')).toBeLessThanOrEqual(20 * MIB);
  });

  it('keeps the largest server level shown when the original does not fit the budget', async () => {
    // The 128 atlas page (16 MiB) and the original (2.5 MiB) pass 18 MiB even with the idle
    // 512 level (0.7 MiB) evicted, so the original is refused and nothing is evicted for it.
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC } }),
      { texturesBytes: 18 * MIB },
    );
    const image = photoImage();
    harness.track(image);
    await harness.settle(cameraAt(1.5));
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);

    const results = await harness.settle(cameraAt(4), 6);

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
    expect(harness.manager.residentKeys()).not.toContain('photo|L1000');
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('keeps the level a refused original would replace, when another upload needs room', async () => {
    // The 128 atlas page (16 MiB) and photo's 512 level (0.67 MiB) leave no room under 17.2 MiB
    // for photo's original (2.5 MiB) nor for other's 512 level: that upload may not evict the
    // 512 level photo shows while its original waits.
    const other = fixtureAssetId('other');
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC, [other]: PHOTO_SPEC } }),
      { texturesBytes: 17.2 * MIB },
    );
    const image = photoImage('photo', PHOTO, 0);
    const small = imageObject({
      id: 'small' as ObjectId,
      assetId: other,
      x: 160,
      width: 40,
      height: 27,
      naturalSize: PHOTO_SPEC.naturalSize,
    });
    harness.track({ ...image, width: 150, height: 100 });
    await harness.settle(cameraAt(1.5));
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);

    harness.track(small);
    const results = await harness.settle(cameraAt(4), 6);

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
    expect(harness.manager.residentKeys()).not.toContain('photo|L1000');
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('evicts the level its own original replaces when only that makes room, never blank', async () => {
    // 19 MiB: the 128 atlas page (16 MiB) and the original (2.54 MiB) fit, with the 512 level
    // (0.67 MiB) too they do not. The original's upload may evict its own asset's 512 level,
    // in the same step it becomes resident.
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC } }),
      { texturesBytes: 19 * MIB },
    );
    const image = photoImage();
    harness.track(image);
    await harness.settle(cameraAt(1.5));
    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);

    const results = await harness.settle(cameraAt(4), 8);

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L1000']);
    expect(harness.manager.residentKeys()).not.toContain('photo|L512');
    expect(harness.ledger.bytesOf('textures')).toBeLessThanOrEqual(19 * MIB);
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('keeps a small shared copy sharp after the larger copy replaces its level', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC } }),
      { texturesBytes: 19 * MIB },
    );
    const small = photoImage('small');
    harness.track(small);
    await harness.settle(cameraAt(1));
    expect(harness.manager.shownKeys(small.id)).toEqual(['photo|L512']);

    const large = { ...photoImage('large'), width: 900, height: 600 };
    harness.track(large);
    const results = await harness.settle(cameraAt(1));
    for (let frame = 0; frame < 20; frame += 1) results.push(harness.frame(cameraAt(1)));

    // The atlas and original fit; retaining the 512 level as well would exceed 19 MiB.
    expect(harness.manager.residentKeys()).not.toContain('photo|L512');
    expect(harness.manager.shownKeys(large.id)).toEqual(['photo|L1000']);
    expect(harness.manager.shownKeys(small.id)).toEqual(['photo|L1000']);
    expect(harness.ledger.bytesOf('textures')).toBeLessThanOrEqual(19 * MIB);
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('keeps the lower level shown for good when the original cannot fit even without it', async () => {
    // 18 MiB: the atlas page and the original pass it even with the 512 level evicted.
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC } }),
      { texturesBytes: 18 * MIB },
    );
    const image = photoImage();
    harness.track(image);
    await harness.settle(cameraAt(1.5));

    const results = await harness.settle(cameraAt(4), 6);
    for (let frame = 0; frame < 20; frame += 1) results.push(harness.frame(cameraAt(4)));

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L512']);
    expect(harness.manager.residentKeys()).toContain('photo|L512');
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('settles two images competing for the room of one original, without ping-pong', async () => {
    // 19.5 MiB: the atlas page, one 512 level and one original fit (19.2 MiB), so one original
    // gets in only by evicting its own 512 level; a second swap does not fit, and neither upload
    // may evict the other image's 512 level.
    const other = fixtureAssetId('other');
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(5, { assets: { [PHOTO]: PHOTO_SPEC, [other]: PHOTO_SPEC } }),
      { texturesBytes: 19.5 * MIB },
    );
    const first = { ...photoImage('first', PHOTO, 0), width: 100, height: 67 };
    const second = { ...photoImage('second', other, 120), width: 100, height: 67 };
    harness.track(first, second);
    await harness.settle(cameraAt(3));
    expect([first, second].map(({ id }) => harness.manager.shownKeys(id))).toEqual([
      ['photo|L512'],
      ['other|L512'],
    ]);

    const results = await harness.settle(cameraAt(8), 8);
    const settled = [first, second].map(({ id }) => harness.manager.shownKeys(id)).flat();
    const later: string[][] = [];
    for (let frame = 0; frame < 20; frame += 1) {
      results.push(harness.frame(cameraAt(8)));
      later.push([first, second].map(({ id }) => harness.manager.shownKeys(id)).flat());
    }

    expect([...settled].sort()).toEqual(['other|L512', 'photo|L1000']);
    expect(later.every((shown) => shown.join() === settled.join())).toBe(true);
    expect(harness.ledger.bytesOf('textures')).toBeLessThanOrEqual(19.5 * MIB);
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
  });

  it('never fetches the original of a tiled image, even before its server levels exist', async () => {
    const gate = new FetchGate();
    const huge = { naturalSize: { width: 8000, height: 6000 }, hasServerLevels: false };
    const source = createFixtureAssetSource(5, {
      assets: { [PHOTO]: huge },
      beforeFetch: gate.beforeFetch,
    });
    const harness = new TextureManagerHarness(source);
    const image = imageObject({ width: 800, height: 600, naturalSize: huge.naturalSize });
    harness.track(image);

    await harness.settle(cameraAt(1));
    expect(harness.manager.shownKeys(image.id)).toEqual(['placeholder']);
    source.publishLevels(PHOTO);
    await harness.settle(cameraAt(1));

    expect(harness.manager.shownKeys(image.id)).toEqual(['photo|L2048']);
    expect(gate.seen).not.toContain('original undefined');
  });
});
