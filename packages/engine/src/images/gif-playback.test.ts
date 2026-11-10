import { describe, expect, it, vi } from 'vitest';

import type { AssetId, ImageObject, ObjectId } from '@canvas/schema';

import { imageObject } from './__fixtures__/image-objects.js';
import { cameraAt, TextureManagerHarness } from './__fixtures__/texture-manager-harness.js';
import type { AssetSource } from './asset-source.js';
import { createFixtureAssetSource, type FixtureAssetSpec } from './fixture-asset-source.js';
import { FIXTURE_GIF_FRAME_COLORS } from './fixture-gif.js';
import { IMAGE_ANIMATION_OWNER } from './gif-playback.js';
import type { TextureManagerParts } from './texture-manager-parts.js';

// Animated GIF playback through the texture manager, on the harness's frozen frame
// clock: frames follow the file's delays, only the current frame is written, GIFs off screen or
// under 64 px decode nothing, and playback never touches the objects it draws.

/** A 300 × 200 GIF of three frames: 100, 200 and 300 ms, looping forever. */
const GIF_SPEC: FixtureAssetSpec = {
  naturalSize: { width: 300, height: 200 },
  animation: { delaysCs: [10, 20, 30] },
};

const [FIRST, SECOND, THIRD] = FIXTURE_GIF_FRAME_COLORS.map((rgb) => [...rgb, 255].join(','));

/**
 * A GIF image object, 300 × 200 world units.
 *
 * @param index - Its number, for its id and its place along x.
 * @param assetId - Its asset.
 * @returns The object, frozen: playback must not write to it.
 */
function gifObject(index: number, assetId = 'gif'): ImageObject {
  return Object.freeze(
    imageObject({
      id: `gif-${String(index)}` as ObjectId,
      assetId: assetId as AssetId,
      x: index * 320,
      width: 300,
      height: 200,
      naturalSize: { width: 300, height: 200 },
    }),
  );
}

/**
 * A harness over fixture GIF assets, counting original fetches, recording the first pixel of
 * every texture write.
 *
 * @param assets - The GIF assets by id.
 * @param settings - Harness settings.
 * @param settings.isMobile - Whether the budget is a mobile profile's.
 * @returns The harness, the writes and the fetches.
 */
function gifHarness(
  assets: Record<string, FixtureAssetSpec> = { gif: GIF_SPEC },
  settings: { readonly isMobile?: boolean } = {},
) {
  const fixture = createFixtureAssetSource(9, { assets });
  const originals: string[] = [];
  const source: AssetSource = {
    ...fixture,
    fetchOriginal: (assetId, signal) => {
      originals.push(assetId);
      return fixture.fetchOriginal(assetId, signal);
    },
  };
  const harness = new TextureManagerHarness(source, settings);
  const writes: string[] = [];
  vi.spyOn(harness.backend, 'writeTexture').mockImplementation((unused, data) => {
    writes.push([...new Uint8Array(data.buffer, data.byteOffset, 4)].join(','));
  });
  return { harness, writes, originals };
}

/**
 * Runs frames, letting loads and jobs finish between them, until an image draws its GIF's slot:
 * playback starts after a frame's plan, and the next frame's plan rebinds the image to the slot.
 *
 * @param harness - The harness.
 * @param id - The image.
 * @returns The time of the frame it started playing on, ms.
 */
async function startPlaying(harness: TextureManagerHarness, id: ObjectId): Promise<number> {
  let previousMs = harness.timeMs;
  for (let frame = 0; frame < 30; frame += 1) {
    harness.frame(cameraAt(1));
    if (harness.manager.shownKeys(id)[0]?.endsWith('|A') === true) return previousMs;
    previousMs = harness.timeMs;
    await harness.jobs.settle();
  }
  throw new Error('The GIF never started playing.');
}

describe('GIF playback', () => {
  it('plays a GIF on screen with its own frame delays, writing only each new frame', async () => {
    const { harness, writes } = gifHarness();
    const gif = gifObject(0);
    harness.track(gif);
    const startMs = await startPlaying(harness, gif.id);
    expect(harness.manager.shownKeys(gif.id)).toEqual(['gif|A']);
    expect(harness.jobs.framesSubmitted).toEqual(['gif']);
    expect(writes.at(-1)).toBe(FIRST);
    // The wait for the second frame is its delay from the start.
    expect(harness.frameWaits.map(({ delayMs }) => delayMs)).toEqual([100]);

    writes.length = 0;
    const camera = cameraAt(1);
    harness.frame(camera, startMs + 50);
    expect(writes).toEqual([]);
    harness.frame(camera, startMs + 100);
    expect(writes).toEqual([SECOND]);
    harness.frame(camera, startMs + 299);
    expect(writes).toEqual([SECOND]);
    harness.frame(camera, startMs + 300);
    expect(writes).toEqual([SECOND, THIRD]);
    // It loops forever: the first frame again after 600 ms, and the second after 700.
    harness.frame(camera, startMs + 650);
    harness.frame(camera, startMs + 700);
    expect(writes).toEqual([SECOND, THIRD, FIRST, SECOND]);
    expect(harness.manager.stats.blankImageFrames).toBe(0);
  });

  it('asks for a frame when the next frame is due, through its timer', async () => {
    const { harness } = gifHarness();
    const gif = gifObject(0);
    harness.track(gif);
    const startMs = await startPlaying(harness, gif.id);
    const [wait] = harness.frameWaits.splice(0);
    harness.frameRequests = 0;
    wait?.run();
    expect(harness.frameRequests).toBe(1);
    harness.frame(cameraAt(1), startMs + 100);
    expect(harness.frameWaits.map(({ delayMs }) => delayMs)).toEqual([200]);
  });

  it('plays a GIF that loops a set number of times once, then holds its last frame', async () => {
    const { harness, writes } = gifHarness({
      gif: { ...GIF_SPEC, animation: { delaysCs: [10, 10], loopCount: 1 } },
    });
    const gif = gifObject(0);
    harness.track(gif);
    const startMs = await startPlaying(harness, gif.id);
    writes.length = 0;
    harness.frameWaits.length = 0;
    for (const offset of [100, 200, 300, 400, 1_000]) harness.frame(cameraAt(1), startMs + offset);
    expect(writes).toEqual([SECOND, FIRST, SECOND]);
    expect(harness.frameWaits.at(-1)?.delayMs).toBe(100);
  });

  it('decodes nothing for a GIF off screen or under 64 px, which shows its still level', async () => {
    const { harness, originals } = gifHarness();
    const gif = gifObject(0);
    harness.track(gif);
    // 300 world units at 0.2× is 60 px on screen.
    await harness.settle(cameraAt(0.2));
    expect(harness.manager.shownKeys(gif.id)).toEqual(['gif|L128']);
    await harness.settle(cameraAt(1, 5_000, 5_000));
    expect(harness.jobs.framesSubmitted).toEqual([]);
    expect(originals).toEqual([]);
    expect(harness.manager.residentKeys().some((key) => key.endsWith('|A'))).toBe(false);
  });

  it('stops at its still level and frees its slot when it shrinks under 64 px', async () => {
    const { harness, writes } = gifHarness();
    const gif = gifObject(0);
    harness.track(gif);
    await harness.settle(cameraAt(1));
    expect(harness.manager.shownKeys(gif.id)).toEqual(['gif|A']);

    harness.frame(cameraAt(0.2), harness.timeMs + 16);
    harness.frame(cameraAt(0.2), harness.timeMs + 16);
    expect(harness.manager.shownKeys(gif.id)[0]).toMatch(/^gif\|L/);
    expect(harness.manager.residentKeys()).not.toContain('gif|A');
    writes.length = 0;
    harness.frame(cameraAt(0.2), harness.timeMs + 1_000);
    expect(writes).toEqual([]);

    // Back on screen it plays again from its first frame, from the frames it kept.
    harness.frame(cameraAt(1), harness.timeMs + 16);
    harness.frame(cameraAt(1), harness.timeMs + 16);
    expect(harness.manager.shownKeys(gif.id)).toEqual(['gif|A']);
    expect(writes).toEqual([FIRST]);
    expect(harness.jobs.framesSubmitted).toEqual(['gif']);
  });

  it('leaves a still GIF on its level, and never decodes it again', async () => {
    const { harness } = gifHarness({ gif: { ...GIF_SPEC, animation: { delaysCs: [10] } } });
    const gif = gifObject(0);
    harness.track(gif);
    await harness.settle(cameraAt(1));
    await harness.settle(cameraAt(1, 5_000));
    await harness.settle(cameraAt(1));
    expect(harness.jobs.framesSubmitted).toEqual(['gif']);
    expect(harness.manager.shownKeys(gif.id)[0]).toMatch(/^gif\|L/);
  });

  it('plays at most two GIFs at once on a mobile profile, and every one on a desktop', async () => {
    const assets = { a: GIF_SPEC, b: GIF_SPEC, c: GIF_SPEC };
    const objects = [gifObject(0, 'a'), gifObject(1, 'b'), gifObject(2, 'c')];
    const mobile = gifHarness(assets, { isMobile: true }).harness;
    mobile.track(...objects);
    await mobile.settle(cameraAt(1));
    expect(mobile.jobs.framesSubmitted).toHaveLength(2);
    const playing = objects.filter(({ id }) => mobile.manager.shownKeys(id)[0]?.endsWith('|A'));
    expect(playing).toHaveLength(2);

    const desktop = gifHarness(assets).harness;
    desktop.track(...objects);
    await desktop.settle(cameraAt(1));
    expect(desktop.jobs.framesSubmitted.sort()).toEqual(['a', 'b', 'c']);
  });

  it('counts the decoded frames under textures and holds them back from the levels', async () => {
    const { harness } = gifHarness();
    harness.track(gifObject(0));
    await harness.settle(cameraAt(1));
    const frameBytes = 300 * 200 * 4 * 3;
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(frameBytes);
  });

  it('writes nothing to the objects it plays, which stay as the document gave them', async () => {
    const { harness } = gifHarness();
    const gif = gifObject(0);
    const before = JSON.stringify(gif);
    harness.track(gif);
    await harness.settle(cameraAt(1));
    for (let step = 1; step <= 10; step += 1) harness.frame(cameraAt(1), harness.timeMs + 100);
    expect(Object.isFrozen(gif)).toBe(true);
    expect(JSON.stringify(gif)).toBe(before);
  });

  it('drops a playing GIF’s frames under pressure, back to its still level, never blank', async () => {
    const assets = {
      gif: { naturalSize: { width: 480, height: 360 }, animation: { delaysCs: [10, 10, 10] } },
      photo: { naturalSize: { width: 4000, height: 3000 } },
    };
    const fixture = createFixtureAssetSource(9, { assets });
    const harness = new TextureManagerHarness(fixture, { texturesBytes: 64 * 1024 * 1024 });
    const gif = Object.freeze(
      imageObject({ id: 'gif' as ObjectId, assetId: 'gif' as AssetId, width: 480, height: 360 }),
    );
    harness.track(gif);
    await startPlaying(harness, gif.id);
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(480 * 360 * 4 * 3);

    // Fill the levels' budget but for 100 kB, so the photo's 512 level cannot fit.
    const { parts } = harness.manager as unknown as { parts: TextureManagerParts };
    const room = parts.residency.budgetBytes - parts.residency.residentBytes;
    expect(parts.uploads.reserve(room - 100_000, () => true)).toBe(true);
    const photo = imageObject({ id: 'photo' as ObjectId, x: 500 });
    harness.track(photo);
    const results = await harness.settle(cameraAt(1));

    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(0);
    expect(harness.manager.shownKeys(gif.id)[0]).toMatch(/^gif\|L/);
    expect(harness.manager.shownKeys(photo.id)).toEqual(['photo|L512']);
    expect(results.every(({ blankImages }) => blankImages === 0)).toBe(true);
    expect(harness.manager.residentKeys()).not.toContain('gif|A');
  });

  it('makes room for a GIF’s frames by evicting idle levels when the budget is full', async () => {
    const assets = {
      gif: GIF_SPEC,
      ...Object.fromEntries(
        Array.from({ length: 6 }, (unused, index) => [
          `photo-${String(index)}`,
          { naturalSize: { width: 4000, height: 3000 } },
        ]),
      ),
    };
    const harness = new TextureManagerHarness(createFixtureAssetSource(9, { assets }), {
      texturesBytes: 64 * 1024 * 1024,
    });
    // Large photos fill the levels' budget, then leave the screen: their levels stay, idle.
    const photos = Array.from({ length: 6 }, (unused, index) =>
      imageObject({
        id: `photo-${String(index)}` as ObjectId,
        assetId: `photo-${String(index)}` as AssetId,
        x: (index % 3) * 340,
        y: Math.floor(index / 3) * 260,
        width: 320,
        height: 240,
      }),
    );
    harness.track(...photos);
    await harness.settle(cameraAt(3));
    const { parts } = harness.manager as unknown as { parts: TextureManagerParts };
    const room = parts.residency.budgetBytes - parts.residency.residentBytes;
    expect(room).toBeLessThan(16 * 1024 * 1024);

    const gif = gifObject(0);
    const far = { ...gif, x: 20_000 } as ImageObject;
    harness.track(far);
    const startCamera = cameraAt(1, 20_000);
    for (let frame = 0; frame < 30; frame += 1) {
      harness.frame(startCamera);
      if (harness.manager.shownKeys(far.id)[0] === 'gif|A') break;
      await harness.jobs.settle();
    }
    expect(harness.manager.shownKeys(far.id)).toEqual(['gif|A']);
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(300 * 200 * 4 * 3);
  });

  it('plays only the images of an asset at 64 px or more; a smaller one keeps its still level', async () => {
    const { harness, writes } = gifHarness();
    const large = gifObject(0);
    const small = Object.freeze(
      imageObject({
        id: 'gif-small' as ObjectId,
        assetId: 'gif' as AssetId,
        x: 400,
        width: 48,
        height: 32,
        naturalSize: { width: 300, height: 200 },
      }),
    );
    harness.track(large, small);
    const startMs = await startPlaying(harness, large.id);
    expect(harness.manager.shownKeys(large.id)).toEqual(['gif|A']);
    expect(harness.manager.shownKeys(small.id)[0]).toMatch(/^gif\|L/);
    harness.frame(cameraAt(1), startMs + 100);
    expect(harness.manager.shownKeys(small.id)[0]).toMatch(/^gif\|L/);

    // The large one leaves the screen: the small one still shows its level, and playback stops.
    harness.track({ ...large, x: 50_000 });
    harness.frame(cameraAt(1), startMs + 116);
    harness.frame(cameraAt(1), startMs + 132);
    expect(harness.manager.shownKeys(small.id)[0]).toMatch(/^gif\|L/);
    expect(harness.manager.residentKeys()).not.toContain('gif|A');
    writes.length = 0;
    for (const offset of [300, 600, 900]) harness.frame(cameraAt(1), startMs + offset);
    expect(writes).toEqual([]);
    expect(harness.jobs.framesSubmitted).toEqual(['gif']);
    expect(harness.manager.isLoading).toBe(false);
  });

  it('looks at no still image for playback on frames that plan nothing', async () => {
    // One described GIF far off screen, and stills on screen: only GIF candidates are looked at.
    const { harness } = gifHarness({
      gif: GIF_SPEC,
      still: { naturalSize: { width: 300, height: 200 } },
    });
    const stills = Array.from({ length: 5 }, (unused, index) => gifObject(index, 'still'));
    const farGif = { ...gifObject(9), x: 100_000 };
    harness.track(...stills, farGif);
    for (let frame = 0; frame < 5; frame += 1) {
      harness.frame(cameraAt(1));
      await harness.jobs.settle();
    }
    expect(harness.catalogue.isDescribedGif('gif' as AssetId)).toBe(true);
    expect(harness.catalogue.isDescribedGif('still' as AssetId)).toBe(false);
    harness.frame(cameraAt(1));
    harness.frame(cameraAt(1));
    const peek = vi.spyOn(harness.catalogue, 'peek');
    // Frames that plan nothing: playback alone would look at each visible image's asset.
    harness.frame(cameraAt(1));
    harness.frame(cameraAt(1));
    expect(peek).not.toHaveBeenCalled();
    expect(harness.jobs.framesSubmitted).toEqual([]);
  });

  it('plays a GIF that comes on screen after frames that looked at no GIF', async () => {
    const { harness } = gifHarness({
      gif: GIF_SPEC,
      still: { naturalSize: { width: 300, height: 200 } },
    });
    const still = gifObject(0, 'still');
    const gif = { ...gifObject(1), x: 5_000 };
    harness.track(still, gif);
    for (let frame = 0; frame < 5; frame += 1) {
      harness.frame(cameraAt(1));
      await harness.jobs.settle();
    }
    expect(harness.jobs.framesSubmitted).toEqual([]);
    harness.track({ ...gif, x: 400 });
    await startPlaying(harness, gif.id);
    expect(harness.manager.shownKeys(gif.id)).toEqual(['gif|A']);
  });

  it('rebinds an image that grows past 64 px while its asset plays, onto the slot', async () => {
    const { harness } = gifHarness();
    const large = gifObject(0);
    const small = imageObject({
      id: 'gif-small' as ObjectId,
      assetId: 'gif' as AssetId,
      x: 400,
      width: 48,
      height: 32,
      naturalSize: { width: 300, height: 200 },
    });
    harness.track(large, small);
    await startPlaying(harness, large.id);
    harness.track({ ...small, width: 150, height: 100 });
    harness.frame(cameraAt(1));
    harness.frame(cameraAt(1));
    expect(harness.manager.shownKeys(small.id)).toEqual(['gif|A']);
  });
});
