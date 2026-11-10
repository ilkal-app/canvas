import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import { AssetCatalogue } from './asset-catalogue.js';
import type { ImageAssetListener } from './asset-source.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';

const PHOTO = fixtureAssetId('photo');
const OTHER = fixtureAssetId('other');
const LEVEL = { widthPx: 128, heightPx: 128, rgba: new Uint8Array(128 * 128 * 4) };

async function cache(catalogue: AssetCatalogue, assetId = PHOTO) {
  const entry = catalogue.use(assetId);
  await flushMicrotasks();
  catalogue.keepSmallest({ kind: 'server', assetId, longEdgePx: 128 }, LEVEL);
  catalogue.release(assetId);
  catalogue.sweep();
  return entry;
}

describe('AssetCatalogue unused thumbnails', () => {
  it('stops following unused assets, then restores and follows them without old callbacks', async () => {
    const listeners: ImageAssetListener[] = [];
    let subscriptions = 0;
    const assets = {
      ...createFixtureAssetSource(1),
      subscribe: (unusedAssetId: AssetId, listener: ImageAssetListener) => {
        listeners.push(listener);
        subscriptions += 1;
        return () => {
          subscriptions -= 1;
        };
      },
    };
    const catalogue = new AssetCatalogue(assets, 8192);
    const old = await cache(catalogue);
    expect(subscriptions).toBe(0);
    expect(catalogue.peek(PHOTO)).toBeUndefined();

    const restored = catalogue.use(PHOTO);
    expect(restored.smallest).toBe(LEVEL);
    expect(restored.hasBeenReady).toBe(true);
    expect(restored.status).toBe('described');
    await flushMicrotasks();
    expect(subscriptions).toBe(1);
    if (old.info === undefined) throw new Error('Expected a described asset');
    listeners[0]?.({ ...old.info, naturalSize: null });
    expect(restored.status).toBe('described');
    catalogue.destroy();
    expect(subscriptions).toBe(0);
    expect(restored.smallest).toBeUndefined();
  });

  it('evicts unused thumbnails and metadata under the existing copy budget', async () => {
    const catalogue = new AssetCatalogue(createFixtureAssetSource(1), 8192, LEVEL.rgba.byteLength);
    const oldest = await cache(catalogue);
    await cache(catalogue, OTHER);

    expect(oldest.smallest).toBeUndefined();
    expect(catalogue.use(PHOTO).hasBeenReady).toBe(false);
    const restored = catalogue.use(OTHER);
    expect(restored.smallest).toBe(LEVEL);
    catalogue.destroy();
    expect(restored.smallest).toBeUndefined();
  });

  it('invalidates an unused thumbnail when a rebuilt backend can no longer hold it', async () => {
    const catalogue = new AssetCatalogue(createFixtureAssetSource(1), 8192);
    const entry = await cache(catalogue);

    catalogue.setMaxTextureSize(100);

    expect(entry.smallest).toBeUndefined();
    expect(catalogue.use(PHOTO).smallest).toBeUndefined();
    catalogue.destroy();
  });

  it('releases unused CPU copies when the catalogue is destroyed', async () => {
    const catalogue = new AssetCatalogue(createFixtureAssetSource(1), 8192);
    const entry = await cache(catalogue);

    catalogue.destroy();

    expect(entry.smallest).toBeUndefined();
    expect(catalogue.peek(PHOTO)).toBeUndefined();
  });
});

it('evicts a newer unused copy before an older active copy', async () => {
  const catalogue = new AssetCatalogue(
    createFixtureAssetSource(1),
    8192,
    2 * LEVEL.rgba.byteLength,
  );
  const active = catalogue.use(PHOTO);
  await flushMicrotasks();
  catalogue.keepSmallest({ kind: 'server', assetId: PHOTO, longEdgePx: 128 }, LEVEL);
  const unused = await cache(catalogue, OTHER);
  const third = fixtureAssetId('third');
  catalogue.use(third);
  await flushMicrotasks();
  catalogue.keepSmallest({ kind: 'server', assetId: third, longEdgePx: 128 }, LEVEL);
  expect(active.smallest).toBe(LEVEL);
  expect(unused.smallest).toBeUndefined();
  catalogue.destroy();
});

it('marks restoration most recent even before the restored copy is read', async () => {
  const catalogue = new AssetCatalogue(
    createFixtureAssetSource(1),
    8192,
    2 * LEVEL.rgba.byteLength,
  );
  await cache(catalogue, PHOTO);
  const other = await cache(catalogue, OTHER);
  const restored = catalogue.use(PHOTO);
  catalogue.release(PHOTO);
  catalogue.sweep();
  await cache(catalogue, fixtureAssetId('third'));
  expect(restored.smallest).toBe(LEVEL);
  expect(other.smallest).toBeUndefined();
  catalogue.destroy();
});

it("cannot restore another catalogue's pixels for the same asset id", async () => {
  const assets = createFixtureAssetSource(1);
  const first = new AssetCatalogue(assets, 8192);
  const old = await cache(first);
  const second = new AssetCatalogue(
    { ...assets, describe: () => Promise.reject(new Error('denied')) },
    8192,
  );
  const foreign = second.use(PHOTO);
  expect(foreign).toMatchObject({ hasBeenReady: false, smallest: undefined, info: undefined });
  await flushMicrotasks();
  expect(foreign.smallest).toBeUndefined();
  first.destroy();
  expect(old.smallest).toBeUndefined();
  second.destroy();
});

it('does not displace an oversized active copy to retain an unused insertion', async () => {
  const catalogue = new AssetCatalogue(
    createFixtureAssetSource(1),
    8192,
    LEVEL.rgba.byteLength / 2,
  );
  const active = catalogue.use(PHOTO);
  await flushMicrotasks();
  catalogue.keepSmallest({ kind: 'server', assetId: PHOTO, longEdgePx: 128 }, LEVEL);
  const unused = catalogue.entry(OTHER);
  await flushMicrotasks();
  catalogue.keepSmallest({ kind: 'server', assetId: OTHER, longEdgePx: 128 }, LEVEL);
  expect(active.smallest).toBe(LEVEL);
  expect(unused.smallest).toBeUndefined();
  catalogue.destroy();
});
