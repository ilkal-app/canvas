import { describe, expect, it, vi } from 'vitest';

import type { AssetId, ImageObject, ObjectId } from '@canvas/schema';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { ManualJobRunner } from './__fixtures__/manual-job-runner.js';
import {
  cameraAt,
  textureBudget,
  TextureManagerHarness,
} from './__fixtures__/texture-manager-harness.js';
import { AssetCatalogue } from './asset-catalogue.js';
import type { AssetSource } from './asset-source.js';
import { createFixtureAssetSource, type FixtureAssetSpec } from './fixture-asset-source.js';
import { IMAGE_ANIMATION_OWNER } from './gif-playback.js';
import { createTextureManagerParts, type TextureManagerParts } from './texture-manager-parts.js';

// GIF playback under the textures budget: the share decoded frames may take, paused
// GIFs giving theirs up first, frames given back under pressure, and loads that fail.

const MIB = 1024 * 1024;
const GIF_SPEC: FixtureAssetSpec = {
  naturalSize: { width: 300, height: 200 },
  animation: { delaysCs: [10, 20, 30] },
};
/** The bytes of one 300 × 200 GIF's three decoded frames. */
const FRAME_BYTES = 300 * 200 * 4 * 3;

function gifObject(index: number, assetId: string): ImageObject {
  return imageObject({
    id: `gif-${String(index)}` as ObjectId,
    assetId: assetId as AssetId,
    x: index * 320,
    width: 300,
    height: 200,
    naturalSize: { width: 300, height: 200 },
  });
}

function partsOf(harness: TextureManagerHarness): TextureManagerParts {
  return (harness.manager as unknown as { parts: TextureManagerParts }).parts;
}

function isPlaying(harness: TextureManagerHarness, object: ImageObject): boolean {
  return harness.manager.shownKeys(object.id)[0]?.endsWith('|A') === true;
}

async function run(harness: TextureManagerHarness, x = 0, frames = 12, zoom = 1): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    harness.frame(cameraAt(zoom, x));
    await harness.jobs.settle();
  }
}

describe('GIF playback under the budget', () => {
  it('holds back at most a quarter of textures, taking a paused GIF’s frames for a new one', async () => {
    // 64 MiB of textures: a 16 MiB share, one desktop GIF's most.
    const assets = { a: GIF_SPEC, b: GIF_SPEC };
    const harness = new TextureManagerHarness(createFixtureAssetSource(9, { assets }), {
      texturesBytes: 64 * MIB,
    });
    const a = gifObject(0, 'a');
    const b = gifObject(1, 'b');
    harness.track(a, b);
    await run(harness);
    // The first one's frames hold part of the share, so the second cannot hold its most.
    expect([isPlaying(harness, a), isPlaying(harness, b)].filter(Boolean)).toHaveLength(1);
    const [shown, other] = isPlaying(harness, a) ? [a, b] : [b, a];
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(FRAME_BYTES);

    // The playing one leaves the view and pauses; the other then takes the share.
    harness.track({ ...shown, x: 50_000 });
    await run(harness);
    expect(isPlaying(harness, other)).toBe(true);
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(FRAME_BYTES);
  });

  it('gives frames back under pressure: a paused GIF’s first, then a playing one’s', async () => {
    const assets = { a: GIF_SPEC, b: GIF_SPEC };
    const harness = new TextureManagerHarness(createFixtureAssetSource(9, { assets }));
    const a = gifObject(0, 'a');
    const b = gifObject(1, 'b');
    harness.track(a, b);
    await run(harness);
    expect(isPlaying(harness, a) && isPlaying(harness, b)).toBe(true);
    harness.track({ ...a, x: 50_000 });
    await run(harness, 0, 2);
    const { playback } = partsOf(harness);

    playback.relieve();
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(FRAME_BYTES);
    expect(isPlaying(harness, b)).toBe(true);
    playback.relieve();
    await run(harness, 0, 2);
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(0);
    expect(isPlaying(harness, b)).toBe(false);
    playback.relieve();
  });

  it('keeps a GIF on its level when its slot does not fit, and plays it again later', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(9, { assets: { a: GIF_SPEC } }),
      {
        texturesBytes: 64 * MIB,
      },
    );
    const a = gifObject(0, 'a');
    harness.track(a);
    // Run until the frames arrive, then leave the slot no room before playback starts.
    for (let frame = 0; frame < 20; frame += 1) {
      harness.frame(cameraAt(1));
      await harness.jobs.settle();
      if ((harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER) ?? 0) > 0) break;
    }
    const { residency, uploads } = partsOf(harness);
    const room = residency.budgetBytes - residency.residentBytes;
    expect(uploads.reserve(room - 1_000, () => true)).toBe(true);
    await run(harness, 0, 3);
    expect(isPlaying(harness, a)).toBe(false);
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(0);
    expect(harness.manager.shownKeys(a.id)[0]).toMatch(/^a\|L/);

    // Off screen and back, with room again, it loads and plays.
    uploads.release(room - 1_000);
    await run(harness, 50_000, 2);
    await run(harness);
    expect(isPlaying(harness, a)).toBe(true);
  });

  it('keeps a GIF on its level when its frames are larger than a texture may be', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(9, { assets: { a: GIF_SPEC } }),
      { maxTextureSize: 256 },
    );
    const a = gifObject(0, 'a');
    harness.track(a);
    await run(harness);
    expect(harness.jobs.framesSubmitted).toEqual(['a']);
    expect(isPlaying(harness, a)).toBe(false);
    expect(harness.ledger.ownersOf('textures').get(IMAGE_ANIMATION_OWNER)).toBe(0);
  });

  it('loads nothing when the needed levels leave no room for a GIF’s frames', async () => {
    const harness = new TextureManagerHarness(
      createFixtureAssetSource(9, { assets: { a: GIF_SPEC } }),
      { texturesBytes: 64 * MIB },
    );
    const a = gifObject(0, 'a');
    harness.track(a);
    // At 0.2× (60 px) its level loads and it does not play; then the room goes.
    await run(harness, 0, 6, 0.2);
    const { residency, uploads } = partsOf(harness);
    const room = residency.budgetBytes - residency.residentBytes;
    expect(uploads.reserve(room - MIB, () => true)).toBe(true);
    await run(harness, 0, 6, 0.3);
    expect(harness.jobs.framesSubmitted).toEqual([]);
    expect(isPlaying(harness, a)).toBe(false);
    expect(harness.manager.shownKeys(a.id)).toEqual(['a|L128']);
  });

  it('stops loading a GIF that leaves the screen before its frames arrive', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = createFixtureAssetSource(9, {
      assets: { a: GIF_SPEC },
      beforeFetch: (request) => (request.kind === 'original' ? held : Promise.resolve()),
    });
    const harness = new TextureManagerHarness(fixture);
    const a = gifObject(0, 'a');
    harness.track(a);
    await run(harness, 0, 6, 0.3);
    expect(harness.manager.isLoading).toBe(true);
    await run(harness, 50_000, 2, 0.3);
    release();
    await run(harness, 50_000, 2, 0.3);
    expect(harness.manager.isLoading).toBe(false);
    expect(harness.jobs.framesSubmitted).toEqual([]);
  });

  it('plays from its slot while the level its size wants is still loading', async () => {
    const fixture = createFixtureAssetSource(9, {
      assets: {
        a: { naturalSize: { width: 600, height: 400 }, animation: { delaysCs: [10, 10] } },
      },
      // The 512 level never arrives; the 128 level and the original do.
      beforeFetch: (request) =>
        request.longEdgePx === 512 ? new Promise<void>(() => undefined) : Promise.resolve(),
    });
    const harness = new TextureManagerHarness(fixture);
    const a = imageObject({
      id: 'a' as ObjectId,
      assetId: 'a' as AssetId,
      width: 300,
      height: 200,
      naturalSize: { width: 600, height: 400 },
    });
    harness.track(a);
    await run(harness);
    expect(harness.manager.residentKeys()).not.toContain('a|L512');
    expect(isPlaying(harness, a)).toBe(true);
  });

  it('keeps a GIF whose original cannot be fetched on its level until it comes back', async () => {
    const fixture = createFixtureAssetSource(9, { assets: { a: GIF_SPEC } });
    let failures = 1;
    const source: AssetSource = {
      ...fixture,
      fetchOriginal: (assetId, signal) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error('offline'));
        }
        return fixture.fetchOriginal(assetId, signal);
      },
    };
    const harness = new TextureManagerHarness(source);
    const a = gifObject(0, 'a');
    harness.track(a);
    // At 0.3× the GIF is 90 px on screen: it plays, and its 128 level needs no original, so the
    // only original fetch is playback's.
    await run(harness, 0, 12, 0.3);
    expect(isPlaying(harness, a)).toBe(false);
    expect(harness.jobs.framesSubmitted).toEqual([]);
    expect(harness.manager.shownKeys(a.id)).toEqual(['a|L128']);
    await run(harness, 50_000, 2, 0.3);
    await run(harness, 0, 12, 0.3);
    expect(isPlaying(harness, a)).toBe(true);
  });

  it('wires level pressure to the playback, which gives frames back and asks for a frame', () => {
    const backend = new FakeGpuBackend();
    const catalogue = new AssetCatalogue(createFixtureAssetSource(9), 8192);
    const markStale = vi.fn();
    const parts = createTextureManagerParts(
      {
        backend,
        catalogue,
        jobs: new ManualJobRunner(),
        ledger: new MemoryLedger(),
        budget: textureBudget(2 * MIB),
        requestFrame: () => undefined,
      },
      {
        onLoaded: () => undefined,
        onDecoderMissing: () => undefined,
        onEvicted: () => undefined,
        onUploaded: () => undefined,
        onAllocationFailed: () => undefined,
        onPlaybackChanged: () => undefined,
        markStale,
      },
    );
    const relieve = vi.spyOn(parts.playback, 'relieve');
    expect(parts.uploads.reserve(MIB, () => true)).toBe(true);
    const source = { kind: 'server', assetId: 'p' as AssetId, longEdgePx: 1024 } as const;
    parts.uploads.add('p|L1024', {
      widthPx: 1024,
      heightPx: 768,
      rgba: new Uint8Array(1024 * 768 * 4),
    });
    parts.uploads.upload(
      new Map([['p|L1024', { key: 'p|L1024', source, priority: 'visible', isNeeded: true }]]),
      0,
      () => true,
    );
    expect(relieve).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenCalled();
    parts.playback.destroy();
  });
});
