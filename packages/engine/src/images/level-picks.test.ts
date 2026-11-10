import { expect, it } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import { imageObject } from './__fixtures__/image-objects.js';
import type { ImageAssetInfo } from './asset-source.js';
import { ImageIndex } from './image-index.js';
import { assetView, type ImageCandidate, type NeedsInput } from './image-needs.js';
import { LevelPicks } from './level-picks.js';
import { pickLevel, requiredLongEdgePx } from './level-selection.js';

function input(zoom: number, dpr: number, isTiled: boolean): NeedsInput {
  const assetId = 'photo' as AssetId;
  const naturalSize = { width: 8000, height: 6000 };
  const info: ImageAssetInfo = {
    mimeType: 'image/png',
    naturalSize,
    levels: [],
    tiles: isTiled ? { tileSizePx: 256, levels: 2, format: 'webp' } : null,
    averageColor: null,
    blurhash: null,
  };
  const view = assetView(assetId, info, naturalSize, [128, 512, 2048, 4096]);
  const candidates = [0, 100, 250].map((width, index): ImageCandidate => {
    const object = imageObject({
      id: `image-${String(index)}` as ObjectId,
      assetId,
      width,
      height: width * 0.75,
      crop: { x: 0, y: 0, width: 0.5, height: 1 },
    });
    const image = new ImageIndex().track({ object, transform: { x: 0, y: 0, cos: 1, sin: 0 } });
    if (!image) throw new Error('Image was not tracked');
    return { image, priority: 'visible' };
  });
  return {
    candidates,
    assetOf: () => view,
    zoom,
    dpr,
    viewport: { minX: 0, minY: 0, maxX: 1000, maxY: 800 },
    budgetBytes: Infinity,
  };
}

it.each([false, true])('proves unchanged picks against the level oracle, tiled=%s', (isTiled) => {
  let proofs = 0;
  for (const zoom of [0.05, 0.2, 1, 8, 32]) {
    for (const dpr of [1, 2]) {
      const picks = new LevelPicks();
      const original = input(zoom, dpr, isTiled);
      expect(picks.canReuseScale(zoom * dpr)).toBe(false);
      picks.pick(original, () => undefined);
      for (let step = 1; step < 400; step += 1) {
        const scale = 0.01 * 1.03 ** step;
        if (!picks.canReuseScale(scale)) continue;
        proofs += 1;
        for (const pick of picks.picks) {
          const { view, candidate, picked } = pick;
          if (!view) throw new Error('Missing asset view');
          const required = requiredLongEdgePx(
            candidate.image.object,
            view.naturalSize,
            candidate.image.object.crop,
            scale,
            1,
          );
          expect(pickLevel(required, view.levels, picked.longEdgePx)).toBe(picked.longEdgePx);
          if (isTiled) expect(required).toBeLessThanOrEqual(view.largest.longEdgePx);
        }
      }
      expect(picks.canReuseScale(Number.NaN)).toBe(false);
      expect(picks.canReuseScale(Infinity)).toBe(false);
    }
  }
  expect(proofs).toBeGreaterThan(100);
});
