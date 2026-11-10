import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { ADA, createFixtureStore, id } from './__fixtures__/store-fixtures.js';
import { DocumentWriteError } from './document-write-error.js';
import { internalsOf } from './internal.js';

const PATH = id('path-squiggle');

/**
 * The fixture store with v3 deleted under s2, as a merge can leave it: s2 stored but hidden.
 *
 * @returns The store and a reader of the stored segment ids.
 */
function withHiddenSegment() {
  const store = createFixtureStore();
  const { doc } = internalsOf(store);
  const map = () => doc.getMap('objects').get(PATH) as Y.Map<unknown>;
  doc.transact(() => {
    (map().get('vertices') as Y.Map<unknown>).delete('v3');
  });
  const storedSegments = () => [...(map().get('segments') as Y.Map<unknown>).keys()].sort();
  return { store, storedSegments };
}

describe('vector network edits', () => {
  it('add, update and delete vertices and segments', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.setVertex(PATH, { id: 'v2', x: 90, y: 5, mirror: 'angle' });
      transaction.setVertex(PATH, { id: 'v4', x: 300, y: 0, mirror: 'none' });
      transaction.setSegment(PATH, {
        id: 's3',
        a: 'v3',
        b: 'v4',
        ha: { x: 0, y: 0 },
        hb: { x: 0, y: 0 },
      });
      transaction.setSegment(PATH, {
        id: 's1',
        a: 'v1',
        b: 'v2',
        ha: { x: 1, y: 1 },
        hb: { x: 0, y: 0 },
      });
      expect(transaction.deleteSegment(PATH, 's2')).toBe(true);
      expect(transaction.deleteSegment(PATH, 's2')).toBe(false);
      expect(transaction.deleteVertex(PATH, 'v9')).toBe(false);
    });
    const path = store.get(PATH);
    expect(path?.type === 'path' && path.vertices.map((vertex) => [vertex.id, vertex.x])).toEqual([
      ['v1', 0],
      ['v2', 90],
      ['v3', 200],
      ['v4', 300],
    ]);
    expect(path?.type === 'path' && path.segments).toEqual([
      { id: 's1', a: 'v1', b: 'v2', ha: { x: 1, y: 1 }, hb: { x: 0, y: 0 } },
      { id: 's3', a: 'v3', b: 'v4', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } },
    ]);
  });

  it('refuse an invalid member, or an edit that leaves the network malformed', () => {
    const store = createFixtureStore();
    const before = store.get(PATH);
    const attempts = [
      () => {
        store.transact(ADA, (transaction) => {
          transaction.setVertex(PATH, { id: '', x: 0, y: 0, mirror: 'none' });
        });
      },
      () => {
        store.transact(ADA, (transaction) => {
          transaction.deleteVertex(PATH, 'v2');
        });
      },
      () => {
        store.transact(ADA, (transaction) => {
          transaction.setSegment(PATH, {
            id: 's9',
            a: 'v1',
            b: 'v7',
            ha: { x: 0, y: 0 },
            hb: { x: 0, y: 0 },
          });
        });
      },
      () => {
        store.transact(ADA, (transaction) => {
          transaction.setSegment(PATH, {
            id: 's9',
            a: 'v1',
            b: 'v1',
            ha: { x: 0, y: 0 },
            hb: { x: 0, y: 0 },
          });
        });
      },
    ];
    for (const attempt of attempts) expect(attempt).toThrow(DocumentWriteError);
    expect(store.get(PATH)).toBe(before);
  });

  it('delete a vertex once its segments are gone, and refuse edits of other types', () => {
    const store = createFixtureStore();
    store.transact(ADA, (transaction) => {
      transaction.deleteSegment(PATH, 's2');
      expect(transaction.deleteVertex(PATH, 'v3')).toBe(true);
    });
    expect(store.get(PATH)).toMatchObject({ vertices: [{ id: 'v1' }, { id: 'v2' }] });
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.setVertex(id('shape-box'), { id: 'v1', x: 0, y: 0, mirror: 'none' });
      });
    }).toThrow(RangeError);
  });

  it('collect the hidden segments at a vertex created, not one waiting for its other end', () => {
    const deleting = withHiddenSegment();
    deleting.store.transact(ADA, (transaction) => {
      transaction.deleteSegment(PATH, 's1');
      transaction.deleteVertex(PATH, 'v2');
    });
    // s2 still waits for v3 (network-collection.ts).
    expect(deleting.storedSegments()).toEqual(['s2']);
    const creating = withHiddenSegment();
    creating.store.transact(ADA, (transaction) => {
      transaction.setVertex(PATH, { id: 'v3', x: 500, y: 500, mirror: 'none' });
      transaction.setVertex(PATH, { id: 'v2', x: 90, y: 0, mirror: 'none' });
    });
    expect(creating.storedSegments()).toEqual(['s1']);
  });

  it('collect the hidden duplicates of a shown segment deleted, never the shown one', () => {
    const store = createFixtureStore();
    const { doc } = internalsOf(store);
    const segments = () =>
      (doc.getMap('objects').get(PATH) as Y.Map<unknown>).get('segments') as Y.Map<unknown>;
    const duplicate = { id: 'z', a: 'v2', b: 'v1', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    doc.transact(() => segments().set('z', [9, duplicate]));
    store.transact(ADA, (transaction) => {
      expect(transaction.deleteSegment(PATH, 'z')).toBe(true);
    });
    expect([...segments().keys()].sort()).toEqual(['s1', 's2']);
    doc.transact(() => segments().set('z', [9, duplicate]));
    store.transact(ADA, (transaction) => transaction.deleteSegment(PATH, 's1'));
    expect([...segments().keys()].sort()).toEqual(['s2']);
  });
});
