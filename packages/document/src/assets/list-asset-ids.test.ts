import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { AssetId, BoardObject } from '@canvas/schema';

import { createDocumentMeta, DOCUMENT_META_KEY, META_MAP_NAME } from '../meta/document-meta.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { listAssetIds } from './list-asset-ids.js';

const PHOTO = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const CLIP = 'clip-demo';
const POSTER = 'clip-demo-poster';

/**
 * The asset ids of a board read the slow way: every object decoded by the store.
 *
 * @param objects - The board's objects.
 * @returns The distinct ids, sorted.
 */
function expectedIds(objects: Iterable<BoardObject>): string[] {
  const ids = new Set<string>();
  for (const object of objects) {
    if (object.type === 'image') ids.add(object.assetId);
    if (object.type === 'video') {
      ids.add(object.assetId);
      if (object.poster !== null) ids.add(object.poster);
    }
  }
  return [...ids].sort();
}

describe('listAssetIds', () => {
  it('lists the images and videos of a board with the posters, sorted', () => {
    const store = createFixtureStore();
    expect(listAssetIds(store.encodeState())).toEqual([PHOTO, CLIP, POSTER].sort());
  });

  it('lists nothing for an empty board', () => {
    expect(listAssetIds(new YjsDocumentStore().encodeState())).toEqual([]);
  });

  it('leaves out a deleted image', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(id('image-photo'));
    });
    expect(listAssetIds(store.encodeState())).toEqual([CLIP, POSTER].sort());
  });

  it('reads the replacement when an image changes asset, after text with emoji', () => {
    // The fixture's sticky holds an emoji: a miscounted string length would shift every later
    // clock of that client and break the replacement's origin.
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(id('image-photo'), { assetId: 'replaced-photo' as AssetId });
      transaction.patchObject(id('video-demo'), { poster: null });
    });
    expect(listAssetIds(store.encodeState())).toEqual(['clip-demo', 'replaced-photo']);
  });

  it('agrees with the decoded board after concurrent edits by two clients', () => {
    const [ada, bob] = createSyncedPair();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(id('image-photo'), { assetId: 'ada-photo' as AssetId });
    });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(id('image-photo'), { assetId: 'bob-photo' as AssetId });
      transaction.setObject({ ...fixtureObject('image-photo', 'image'), id: id('image-bob') });
    });
    exchange(ada, bob);
    const state = ada.encodeState();
    expect(listAssetIds(state)).toEqual(expectedIds(ada.read().objects.values()));
    expect(listAssetIds(bob.encodeState())).toEqual(listAssetIds(state));
  });

  it('skips the layout stamp and anything else outside the objects map', () => {
    const store = createFixtureStore();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, store.encodeState());
    expect(doc.getMap(META_MAP_NAME).get(DOCUMENT_META_KEY)).toBeDefined();
    // A peer's re-stamp is written without its key (update-scan.test.ts) and skipped too.
    doc.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, createDocumentMeta());
    doc.getMap(META_MAP_NAME).set('style', { assetId: 'in-the-meta-map' });
    expect(listAssetIds(Y.encodeStateAsUpdate(doc))).toEqual([PHOTO, CLIP, POSTER].sort());
  });

  it('skips deleted content a document kept because garbage collection was off', () => {
    const store = createFixtureStore();
    const doc = new Y.Doc({ gc: false });
    Y.applyUpdate(doc, store.encodeState());
    doc.getMap('objects').delete('image-photo');
    expect(listAssetIds(Y.encodeStateAsUpdate(doc))).toEqual([CLIP, POSTER].sort());
  });

  it('ignores asset-like values outside objects, untyped objects and invalid asset ids', () => {
    const doc = new Y.Doc();
    doc.getMap('elsewhere').set('assetId', 'not-on-the-board');
    const object = new Y.Map<unknown>();
    doc.getMap('objects').set('image-bad', object);
    object.set('identity', { id: 'image-bad', type: 'image' });
    object.set('style', { assetId: 'has a space' });
    const untyped = new Y.Map<unknown>();
    doc.getMap('objects').set('image-untyped', untyped);
    untyped.set('style', { assetId: 'no-identity' });
    const malformed = new Y.Map<unknown>();
    doc.getMap('objects').set('image-malformed', malformed);
    malformed.set('identity', 'image');
    malformed.set('style', { assetId: 'identity-not-an-object' });
    const outside = new Y.Map<unknown>();
    doc.getMap('elsewhere').set('image-outside', outside);
    outside.set('identity', { id: 'image-outside', type: 'image' });
    outside.set('style', { assetId: 'not-in-objects' });
    expect(listAssetIds(Y.encodeStateAsUpdate(doc))).toEqual([]);
  });

  it('matches the decoded board on the synthetic board after edits', () => {
    const objects = createLargeBoardObjects(2_000, 72);
    const store = new YjsDocumentStore();
    store.transact(ADA, (transaction) => {
      for (const object of objects) transaction.setObject(object);
    });
    const images = objects.filter((object) => object.type === 'image');
    store.transact(BOB, (transaction) => {
      images.slice(0, 20).forEach((image, index) => {
        transaction.patchObject(image.id, { assetId: `edited-${String(index)}` as AssetId });
      });
      for (const image of images.slice(20, 40)) transaction.deleteObject(image.id);
    });
    expect(listAssetIds(store.encodeState())).toEqual(expectedIds(store.read().objects.values()));
  });

  it('skips an entry whose replaced value is not in the update, as in a partial update', () => {
    const doc = new Y.Doc();
    const object = new Y.Map<unknown>();
    doc.getMap('objects').set('image-1', object);
    object.set('identity', { id: 'image-1', type: 'image' });
    object.set('style', { assetId: 'first' });
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    object.set('style', { assetId: 'second' });
    expect(listAssetIds(Y.encodeStateAsUpdate(doc))).toEqual(['second']);
    expect(listAssetIds(updates[0] ?? new Uint8Array())).toEqual([]);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const fromPeer: Uint8Array[] = [];
    peer.on('update', (update: Uint8Array) => fromPeer.push(update));
    (peer.getMap('objects').get('image-1') as Y.Map<unknown>).set('style', { assetId: 'third' });
    expect(listAssetIds(fromPeer[0] ?? new Uint8Array())).toEqual([]);
  });

  it('gives up on an origin cycle in a malformed update instead of looping', () => {
    const encoder = encoding.createEncoder();
    for (const value of [1, 2, 4, 0]) encoding.writeVarUint(encoder, value);
    for (const originClock of [1, 0]) {
      encoding.writeUint8(encoder, 0b1000_1000); // ContentAny with an origin
      encoding.writeVarUint(encoder, 4);
      encoding.writeVarUint(encoder, originClock);
      encoding.writeVarUint(encoder, 1);
      encoding.writeAny(encoder, { assetId: 'looped' });
    }
    encoding.writeVarUint(encoder, 0);
    expect(listAssetIds(encoding.toUint8Array(encoder))).toEqual([]);
  });

  it('throws on a truncated state', () => {
    const state = createFixtureStore().encodeState();
    expect(() => listAssetIds(state.subarray(0, state.length >> 1))).toThrow();
  });
});
