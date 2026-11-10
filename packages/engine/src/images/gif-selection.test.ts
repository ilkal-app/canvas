import { describe, expect, it } from 'vitest';

import type { AssetId, ObjectId } from '@canvas/schema';

import { imageObject } from './__fixtures__/image-objects.js';
import { onScreenEdgePx, selectPlayingAssets } from './gif-selection.js';
import type { ImageCandidate } from './image-needs.js';

function candidate(
  id: string,
  assetId: string,
  widthPx: number,
  priority: ImageCandidate['priority'] = 'visible',
): ImageCandidate {
  const object = imageObject({
    id: id as ObjectId,
    assetId: assetId as AssetId,
    width: widthPx,
    height: (widthPx * 3) / 4,
  });
  return {
    image: {
      object,
      target: { object, transform: { x: 0, y: 0, cos: 1, sin: 0 } },
      transform: { x: 0, y: 0, cos: 1, sin: 0 },
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    },
    priority,
  };
}

describe('selectPlayingAssets', () => {
  const isAnimatable = (object: { readonly assetId: AssetId }): boolean =>
    object.assetId !== 'still';

  it('plays visible animatable images of 64 px or more, by asset at their largest', () => {
    const playing = selectPlayingAssets({
      candidates: [
        candidate('a1', 'a', 100),
        candidate('a2', 'a', 300),
        candidate('b', 'b', 63),
        candidate('c', 'c', 400, 'near'),
        candidate('d', 'still', 400),
      ],
      zoom: 1,
      maxPlaying: Infinity,
      playing: new Set(),
      isAnimatable,
    });
    expect([...playing]).toEqual([['a' as AssetId, { edgePx: 300, objects: ['a1', 'a2'] }]]);
    expect(onScreenEdgePx(candidate('x', 'x', 200).image.object, 0.5)).toBe(100);
  });

  it('keeps the GIFs playing at the cap, then the largest, then by asset id', () => {
    const candidates = ['d', 'b', 'c', 'a'].map((name) => candidate(name, name, 200));
    candidates.push(candidate('e', 'e', 500));
    const pick = (playing: string[]) =>
      [
        ...selectPlayingAssets({
          candidates,
          zoom: 1,
          maxPlaying: 2,
          playing: new Set(playing as AssetId[]),
          isAnimatable,
        }).keys(),
      ].sort();
    expect(pick([])).toEqual(['a', 'e']);
    expect(pick(['d', 'c'])).toEqual(['c', 'd']);
  });
});
