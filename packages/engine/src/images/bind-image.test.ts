import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import { AssetCatalogue } from './asset-catalogue.js';
import { shownLevel } from './bind-image.js';
import { createFixtureAssetSource, fixtureAssetId } from './fixture-asset-source.js';
import type { ResidentLevel } from './resident-level.js';

describe('shownLevel', () => {
  it('keeps an intermediate lower level over a resident higher one while the target loads', async () => {
    const assetId = fixtureAssetId('photo');
    const catalogue = new AssetCatalogue(
      createFixtureAssetSource(5, {
        assets: { [assetId]: { naturalSize: { width: 4000, height: 3000 } } },
      }),
      8192,
    );
    const entry = catalogue.entry(assetId);
    await flushMicrotasks();
    const levels: ResidentLevel[] = [128, 512, 4000].map((size, page) => ({
      key: `photo|L${String(size)}`,
      widthPx: size,
      heightPx: size * 0.75,
      region: { page, u0: 0, v0: 0, u1: 1, v1: 1 },
      bytes: size * size * 3,
      entry: undefined,
      texture: undefined,
      lastUsedFrame: 0,
    }));

    const shown = shownLevel(entry, 2048, (key) => levels.find((level) => level.key === key));

    expect(shown?.key).toBe('photo|L512');
    catalogue.destroy();
  });
});

it.each([
  { above: 2048, hasThumbnail: true, expected: 2048 },
  { above: 2049, hasThumbnail: true, expected: 128 },
  { above: 4096, hasThumbnail: false, expected: 4096 },
])(
  'caps optional downsampling without discarding the only resident level: %o',
  async ({ above, hasThumbnail, expected }) => {
    const assetId = fixtureAssetId('photo');
    const catalogue = new AssetCatalogue(
      createFixtureAssetSource(5, {
        assets: { [assetId]: { naturalSize: { width: above, height: above } } },
      }),
      8192,
    );
    const entry = catalogue.entry(assetId);
    await flushMicrotasks();
    const levels: ResidentLevel[] = (hasThumbnail ? [128, above] : [above]).map((size, page) => ({
      key: `photo|L${String(size)}`,
      widthPx: size,
      heightPx: size,
      region: { page, u0: 0, v0: 0, u1: 1, v1: 1 },
      bytes: size * size * 4,
      entry: undefined,
      texture: undefined,
      lastUsedFrame: 0,
    }));
    try {
      expect(shownLevel(entry, 512, (key) => levels.find((level) => level.key === key))?.key).toBe(
        `photo|L${String(expected)}`,
      );
    } finally {
      catalogue.destroy();
    }
  },
);
