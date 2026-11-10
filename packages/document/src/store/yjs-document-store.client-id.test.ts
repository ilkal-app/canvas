import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { ADA, fixtureObject } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

describe('YjsDocumentStore client ids', () => {
  it('writes with a given client id, so the same writes encode to the same bytes', () => {
    const encode = () => {
      const store = new YjsDocumentStore({ clientId: 47 });
      store.transact(ADA, (transaction) => {
        transaction.setObject(fixtureObject('sticky-idea', 'sticky'));
      });
      return store.encodeState();
    };
    expect(encode()).toEqual(encode());
    const decoded = Y.decodeUpdate(encode());
    expect(new Set(decoded.structs.map((struct) => struct.id.client))).toEqual(new Set([47]));
  });

  it('says which client id it writes under, given or drawn', () => {
    expect(new YjsDocumentStore({ clientId: 47 }).clientId).toBe(47);
    const drawn = new YjsDocumentStore();
    drawn.transact(ADA, (transaction) => {
      transaction.setObject(fixtureObject('sticky-idea', 'sticky'));
    });
    const [struct] = Y.decodeUpdate(drawn.encodeState()).structs;
    expect(struct?.id.client).toBe(drawn.clientId);
  });

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('refuses the client id %s', (clientId) => {
    expect(() => new YjsDocumentStore({ clientId })).toThrow(RangeError);
  });
});
