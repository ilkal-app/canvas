// PR 1: GC must keep assets referenced by shape fills and frame backgrounds.
import { describe, expect, it } from 'vitest';

import type { AssetId, Paint } from '@canvas/schema';

import { ADA, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { listAssetIds } from './list-asset-ids.js';

const ASSET = 'shared-asset' as AssetId;
const PAINT = {
  type: 'image',
  assetId: ASSET,
  naturalSize: { width: 1600, height: 900 },
  fit: 'crop',
  crop: { x: 0, y: 0, width: 1, height: 1 },
} as unknown as Paint;

describe('image paint asset liveness', () => {
  it('lists fill and background assets beside images and video, once per id', () => {
    const store = new YjsDocumentStore();
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...fixtureObject('shape-box', 'shape'), fill: PAINT });
      transaction.setObject({ ...fixtureObject('frame-plan', 'frame'), background: PAINT });
      transaction.setObject({ ...fixtureObject('image-photo', 'image'), assetId: ASSET });
      transaction.setObject(fixtureObject('video-demo', 'video'));
    });
    expect(listAssetIds(store.encodeState())).toEqual(
      [ASSET, 'clip-demo', 'clip-demo-poster'].sort(),
    );
  });
});
