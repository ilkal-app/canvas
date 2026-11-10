import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { listAssetIds } from './list-asset-ids.js';

/**
 * Creates the approved instance map shape without requiring component commands.
 *
 * @param document - The document holding this entry.
 * @param type - The stored discriminator, to check that only instance overrides count.
 * @returns Its integrated override map.
 */
function instanceOverrides(document: Y.Doc, type = 'instance'): Y.Map<unknown> {
  const overrides = new Y.Map<unknown>();
  document.getMap('objects').set(
    'instance',
    new Y.Map<unknown>([
      ['identity', { id: 'instance', type, mainId: 'retained-main' }],
      ['overrides', overrides],
    ]),
  );
  return overrides;
}

describe('listAssetIds instance overrides', () => {
  it('retains an asset referenced only by a nested child override', () => {
    const document = new Y.Doc({ gc: false });
    const overrides = instanceOverrides(document);
    overrides.set('nested/photo', { assetId: 'override-photo' });
    overrides.set('__proto__', { assetId: 'another-photo' });
    expect(listAssetIds(Y.encodeStateAsUpdate(document))).toEqual([
      'another-photo',
      'override-photo',
    ]);
  });

  it('follows live replacements and removes deleted paths and instances', () => {
    const document = new Y.Doc({ gc: false });
    const overrides = instanceOverrides(document);
    overrides.set('photo', { assetId: 'old-photo' });
    overrides.set('photo', { assetId: 'new-photo' });
    overrides.set('removed', { assetId: 'removed-photo' });
    overrides.delete('removed');
    expect(listAssetIds(Y.encodeStateAsUpdate(document))).toEqual(['new-photo']);
    document.getMap('objects').delete('instance');
    expect(listAssetIds(Y.encodeStateAsUpdate(document))).toEqual([]);
  });

  it('ignores unrelated maps, invalid asset ids and overrides on non-instances', () => {
    const document = new Y.Doc();
    const overrides = instanceOverrides(document, 'frame');
    overrides.set('photo', { assetId: 'not-an-instance' });
    document.getMap('unrelated').set('overrides', new Y.Map([['photo', { assetId: 'unrelated' }]]));
    expect(listAssetIds(Y.encodeStateAsUpdate(document))).toEqual([]);
    document.getMap('objects').clear();
    instanceOverrides(document).set('photo', { assetId: '../../bad' });
    expect(listAssetIds(Y.encodeStateAsUpdate(document))).toEqual([]);
  });
});
