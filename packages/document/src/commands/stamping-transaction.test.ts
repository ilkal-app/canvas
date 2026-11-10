import { describe, expect, it } from 'vitest';

import {
  ADA,
  BODY,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentTransaction } from '../store/document-store.js';

import { mustGet, NOW } from './__fixtures__/command-fixtures.js';
import { StampingTransaction } from './stamping-transaction.js';

describe('StampingTransaction', () => {
  it('stamps every object written through it, by any kind of write, and nothing else', () => {
    const store = createFixtureStore();
    const before = store.read();
    store.transact(ADA, (transaction) => {
      const stamping = new StampingTransaction(transaction);
      expect(stamping.origin).toBe(transaction.origin);
      stamping.setObject({ ...fixtureObject('image-photo', 'image'), opacity: 0.5 });
      stamping.patchObject(id('video-demo'), { loop: false });
      stamping.insertText(id('sticky-idea'), 0, 'A ', BODY);
      stamping.deleteText(id('text-title'), 0, 1);
      stamping.formatText(id('shape-box'), 0, 1, { italic: true });
      stamping.setSegment(id('path-squiggle'), {
        id: 's3',
        a: 'v3',
        b: 'v1',
        ha: { x: 0, y: 0 },
        hb: { x: 0, y: 0 },
      });
      stamping.setVertex(id('path-squiggle'), { id: 'v1', x: 1, y: 1, mirror: 'none' });
      expect(stamping.deleteSegment(id('path-squiggle'), 's3')).toBe(true);
      expect(stamping.deleteVertex(id('path-squiggle'), 'v9')).toBe(false);
      stamping.patchObject(id('comment-free'), { x: 1 });
      expect(stamping.deleteObject(id('comment-free'))).toBe(true);
      expect(stamping.get(id('comment-free'))).toBeUndefined();
      stamping.stamp(NOW);
    });
    const stamped = ['image-photo', 'video-demo', 'sticky-idea', 'text-title', 'shape-box'];
    for (const key of [...stamped, 'path-squiggle']) {
      expect(mustGet(store, key).updatedAt).toBe(NOW);
    }
    expect(store.get(id('line-divider'))).toBe(before.objects.get(id('line-divider')));
  });

  it("reads the board's colour tokens through to the transaction it wraps", () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      const stamping = new StampingTransaction(transaction);
      expect(stamping.tokens().size).toBe(0);
      const token = {
        id: 'brand',
        name: 'Brand',
        light: [1, 0, 0, 1],
        dark: [0, 0, 1, 1],
      } as const;
      stamping.setToken(
        { ...token, light: [...token.light], dark: [...token.dark] },
        { createdBy: transaction.origin.principalId, createdAt: NOW },
      );
      expect(stamping.tokens().get('brand')).toMatchObject({ name: 'Brand', light: [1, 0, 0, 1] });
      expect(transaction.tokens()).toEqual(stamping.tokens());
    });
    expect(store.readTokens().get('brand')?.dark).toEqual([0, 0, 1, 1]);
  });

  it('writes nothing more for an object that already carries the time', () => {
    const store = createFixtureStore();
    const patched: string[] = [];
    store.transact(ADA, (transaction) => {
      const counting: DocumentTransaction = {
        ...transaction,
        origin: transaction.origin,
        get: (objectId) => transaction.get(objectId),
        patchObject: (objectId, patch) => {
          patched.push(objectId);
          transaction.patchObject(objectId, patch);
        },
      };
      const stamping = new StampingTransaction(counting);
      stamping.patchObject(id('video-demo'), { loop: false, updatedAt: NOW });
      stamping.patchObject(id('image-photo'), { opacity: 0.5 });
      stamping.stamp(NOW);
    });
    expect(patched).toEqual(['video-demo', 'image-photo', 'image-photo']);
    expect(mustGet(store, 'image-photo')).toMatchObject({ opacity: 0.5, updatedAt: NOW });
  });
});
