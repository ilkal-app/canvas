import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import { FIXTURE_GIF_FRAME_COLORS } from './fixture-gif.js';
import { readFixtureImage } from './fixture-image.js';
import { parseGif } from './gif-file.js';
import { decodeGifFrames } from './gif-frames.js';

const PHOTO = fixtureAssetId('photo');

describe('createFixtureAssetSource', () => {
  it('describes an asset it was given with the levels below its long edge', async () => {
    const source = createFixtureAssetSource(1, {
      assets: { [PHOTO]: { naturalSize: { width: 3000, height: 2000 } } },
    });

    const info = await source.describe(PHOTO);

    expect(info.naturalSize).toEqual({ width: 3000, height: 2000 });
    expect(info.levels.map(({ longEdgePx }) => longEdgePx)).toEqual([128, 512, 2048]);
    expect(info.tiles).toBeNull();
    expect(info.averageColor?.[3]).toBe(1);
  });

  it('tiles an asset larger than the largest level', async () => {
    const source = createFixtureAssetSource(1, {
      assets: { [PHOTO]: { naturalSize: { width: 8000, height: 6000 } } },
    });

    const info = await source.describe(PHOTO);

    expect(info.levels.map(({ longEdgePx }) => longEdgePx)).toEqual([128, 512, 2048, 4096]);
    // As the assets service tiles: only the levels above 4096 px, here full resolution alone.
    expect(info.tiles).toEqual({ tileSizePx: 256, levels: 1, format: 'webp' });
  });

  it('makes up a stable size for an asset it was not given', async () => {
    const source = createFixtureAssetSource(1);
    const other = createFixtureAssetSource(1);

    const [first, second] = await Promise.all([
      source.describe('anything' as AssetId),
      other.describe('anything' as AssetId),
    ]);

    expect(first).toEqual(second);
    expect(first.naturalSize?.width).toBeGreaterThan(0);
  });

  it('serves levels, tiles and the original as fixture images of the right size', async () => {
    const source = createFixtureAssetSource(3, {
      assets: { [PHOTO]: { naturalSize: { width: 8000, height: 6000 } } },
    });

    const level = readFixtureImage(await source.fetchLevel(PHOTO, 512));
    const tile = readFixtureImage(await source.fetchTile(PHOTO, { level: 0, column: 31, row: 0 }));
    const original = readFixtureImage(await source.fetchOriginal(PHOTO));

    expect(level).toMatchObject({ seed: 3, widthPx: 512, heightPx: 384 });
    // Full resolution, 8000 px wide: the last column starts at 7936 and is 64 px wide.
    expect(tile).toMatchObject({ widthPx: 64, heightPx: 256 });
    expect(tile.region.minU).toBeCloseTo(7936 / 8000);
    expect(original).toMatchObject({ widthPx: 8000, heightPx: 6000 });
  });

  it('refuses a level the asset does not have', async () => {
    const source = createFixtureAssetSource(1, {
      assets: { [PHOTO]: { naturalSize: { width: 300, height: 200 } } },
    });

    await expect(source.fetchLevel(PHOTO, 2048)).rejects.toThrow(RangeError);
  });

  it('holds back server levels until they are published, then tells subscribers', async () => {
    const source = createFixtureAssetSource(1, {
      assets: { [PHOTO]: { naturalSize: { width: 3000, height: 2000 }, hasServerLevels: false } },
    });
    const seen: number[][] = [];
    const stop = source.subscribe(PHOTO, (info) => {
      seen.push(info.levels.map(({ longEdgePx }) => longEdgePx));
    });

    expect((await source.describe(PHOTO)).levels).toEqual([]);
    await expect(source.fetchLevel(PHOTO, 512)).rejects.toThrow(RangeError);
    source.publishLevels(PHOTO);
    stop();
    source.publishLevels(PHOTO);

    expect(seen).toEqual([[128, 512, 2048]]);
    expect((await source.describe(PHOTO)).levels).toHaveLength(3);
  });

  it('waits for the gate before answering a fetch', async () => {
    const order: string[] = [];
    const source = createFixtureAssetSource(1, {
      assets: { [PHOTO]: { naturalSize: { width: 3000, height: 2000 } } },
      beforeFetch: async (request) => {
        order.push(`gate ${request.kind} ${String(request.longEdgePx)}`);
        await Promise.resolve();
      },
    });

    await source.fetchLevel(PHOTO, 128);

    expect(order).toEqual(['gate level 128']);
  });

  it('honours the abort signal of a fetch, before and while the gate holds it', async () => {
    const source = createFixtureAssetSource(1, {
      assets: { [PHOTO]: { naturalSize: { width: 3000, height: 2000 } } },
      beforeFetch: () => new Promise<void>(() => undefined),
    });
    const early = new AbortController();
    early.abort(new Error('not wanted'));
    const held = new AbortController();

    const whileHeld = source.fetchLevel(PHOTO, 512, held.signal);
    held.abort(new Error('scrolled away'));

    await expect(source.fetchOriginal(PHOTO, early.signal)).rejects.toThrow('not wanted');
    await expect(whileHeld).rejects.toThrow('scrolled away');
  });

  it('refuses a tile of an untiled asset or of a level its pyramid does not have', async () => {
    const small = fixtureAssetId('small');
    const large = fixtureAssetId('large');
    const assets = createFixtureAssetSource(1, {
      assets: {
        [small]: { naturalSize: { width: 1000, height: 800 } },
        [large]: { naturalSize: { width: 8000, height: 6000 } },
      },
    });

    await expect(assets.fetchTile(small, { level: 0, column: 0, row: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(assets.fetchTile(large, { level: 5, column: 0, row: 0 })).rejects.toThrow(
      RangeError,
    );
    expect(() => {
      assets.publishLevels(small);
    }).not.toThrow();
  });

  it('serves an animated asset as a GIF: its frames in the original, its first in each level', async () => {
    const gif = fixtureAssetId('gif');
    const source = createFixtureAssetSource(1, {
      assets: {
        gif: { naturalSize: { width: 300, height: 200 }, animation: { delaysCs: [5, 7] } },
      },
    });

    expect((await source.describe(gif)).mimeType).toBe('image/gif');
    const original = decodeGifFrames(new Uint8Array(await source.fetchOriginal(gif)), {
      maxLongEdgePx: 512,
      maxBytes: 1024 * 1024,
    });
    expect(original).toMatchObject({ widthPx: 300, heightPx: 200, plays: Infinity });
    expect(original.frames.map(({ durationMs }) => durationMs)).toEqual([50, 70]);
    expect([...(original.frames[1]?.rgba.subarray(0, 3) ?? [])]).toEqual([
      ...(FIXTURE_GIF_FRAME_COLORS[1] ?? []),
    ]);
    const level = parseGif(new Uint8Array(await source.fetchLevel(gif, 128)));
    expect(level).toMatchObject({ widthPx: 128, heightPx: 85 });
    expect(level.frames).toHaveLength(1);
  });

  it('makes every unlisted animated-gif- asset the same 480 × 360 GIF', async () => {
    const source = createFixtureAssetSource(1);
    const info = await source.describe(fixtureAssetId('animated-gif-007'));
    expect(info).toMatchObject({ mimeType: 'image/gif', naturalSize: { width: 480, height: 360 } });
    const first = await source.fetchOriginal(fixtureAssetId('animated-gif-007'));
    const second = await source.fetchOriginal(fixtureAssetId('animated-gif-008'));
    // Compared byte by byte in a loop: a deep equality over a megabyte is slow to report.
    const [firstBytes, secondBytes] = [new Uint8Array(first), new Uint8Array(second)];
    expect(firstBytes.length).toBe(secondBytes.length);
    expect(firstBytes.findIndex((byte, index) => byte !== secondBytes[index])).toBe(-1);
    expect(parseGif(new Uint8Array(first)).frames).toHaveLength(12);
  });
});
