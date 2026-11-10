// Fix round 1: lib0 carries objects JavaScript cannot convert to a primitive (an own
// `toString: 1`, a prototype set through `__proto__`, no prototype), and on each `<`, arithmetic,
// a template literal and `String()` throw, as they do on a bigint. A peer's `z` of that kind
// threw out of `compareSiblings` on every client's next read, and a segment end of that kind
// threw out of `String()` inside `editNetwork`'s `apply`. The reader now refuses such an object
// as `malformed-field`, whatever field holds it. Real remote updates.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import { ADA, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { changeKey, receiveWrite, UNCONVERTIBLE } from './__fixtures__/remote-write.js';
import { collectedSegments, memberWrite } from './network-collection.js';
import { toYjs } from './object-codec.js';

/**
 * Checks the receiver still works: it reads, the reverse indexes answer, and a transaction that
 * creates an object at the root (which compares stacking keys) succeeds.
 *
 * @param store - The receiver.
 */
function expectUsable(store: ReturnType<typeof createFixtureStore>): void {
  expect(() => store.read()).not.toThrow();
  expect(() => sortedSiblings(store, null)).not.toThrow();
  expect(() => store.references.topChildOf(null)).not.toThrow();
  expect(() => {
    store.transact(ADA, (transaction) => {
      transaction.setObject({
        ...fixtureObject('shape-box', 'shape'),
        id: id('fresh'),
        parentId: null,
      });
      transaction.patchObject(id('frame-plan'), { x: 42 });
    });
  }).not.toThrow();
  expect(store.get(id('frame-plan'))?.x).toBe(42);
  expect(store.get(id('fresh'))).toBeDefined();
}

describe.each(UNCONVERTIBLE)('an object with %s in a field', (shape, value) => {
  it('as z: the object is a decode issue and the next read and transaction work', () => {
    const { store } = receiveWrite(changeKey('shape-box', 'z', () => value));
    expect(store.get(id('shape-box'))).toBeUndefined();
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-field', key: 'shape-box', field: 'z' }),
    );
    expectUsable(store);
    expect(store.references.childrenOf(id('group-diagram')).has(id('shape-box'))).toBe(false);
  });

  it('as z once the parent top is known: read and transact do not throw out of compareSiblings', () => {
    const parent = fixtureObject('shape-box', 'shape').parentId;
    const { store } = receiveWrite(
      changeKey('shape-box', 'z', () => value),
      (receiver) => {
        receiver.references.topChildOf(parent);
      },
    );
    expect(() => store.read()).not.toThrow();
    expect(() => store.references.topChildOf(parent)).not.toThrow();
    expect(store.get(id('shape-box'))).toBeUndefined();
    expectUsable(store);
  });

  it('as x: the object is a decode issue, not a TypeError in rendering', () => {
    const { store } = receiveWrite(
      changeKey('shape-box', 'placement', (group) => ({
        ...(group as Record<string, unknown>),
        x: value,
      })),
    );
    expect(store.get(id('shape-box'))).toBeUndefined();
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-field', key: 'shape-box' }),
    );
    expectUsable(store);
  });

  it('as a type or an id: the object is a decode issue and the next transaction works', () => {
    const { store } = receiveWrite(
      changeKey('shape-box', 'identity', (group) => ({
        ...(group as Record<string, unknown>),
        type: value,
      })),
    );
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-field', key: 'shape-box' }),
    );
    expectUsable(store);
  });

  it('as a segment end: the path is a decode issue and editNetwork refuses cleanly', () => {
    const { store } = receiveWrite((objects) => {
      const segments = objects.get('path-squiggle')?.get('segments') as Y.Map<unknown>;
      const [order, segment] = segments.get('s2') as [number, Record<string, unknown>];
      segments.set('s2', [order, { ...segment, b: value }]);
    });
    expect(store.get(id('path-squiggle'))).toBeUndefined();
    expect(store.read().issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-field', key: 'path-squiggle' }),
    );
    expectUsable(store);
  });
});

describe('a batch in which one object is refused', () => {
  it('indexes the others and leaves the index whole', () => {
    const { store } = receiveWrite((objects) => {
      const fresh = toYjs({
        ...fixtureObject('shape-box', 'shape'),
        id: id('fresh'),
        parentId: null,
      });
      objects.set('fresh', fresh);
      objects.get('shape-star')?.set('z', { toString: 1 });
    });
    expect(store.get(id('fresh'))?.parentId).toBeNull();
    expect(store.get(id('shape-star'))).toBeUndefined();
    expect(store.references.childrenOf(null).has(id('fresh'))).toBe(true);
    const parent = fixtureObject('shape-star', 'shape').parentId;
    expect(store.references.childrenOf(parent).has(id('shape-star'))).toBe(false);
    expect(store.references.topChildOf(null)).toBeDefined();
    expect(sortedSiblings(store, null)).toContain(id('fresh'));
    expectUsable(store);
  });
});

describe('collectedSegments on a stored segment with an end it cannot convert', () => {
  it.each(UNCONVERTIBLE)('does not throw for %s', (shape, value) => {
    const doc = new Y.Doc();
    const vertices = doc.getMap<unknown>('vertices');
    const segments = doc.getMap<unknown>('segments');
    vertices.set('v1', [0, { id: 'v1' }]);
    vertices.set('v2', [1, { id: 'v2' }]);
    segments.set('s2', [0, { id: 's2', a: 'v2', b: value }]);
    const write = memberWrite(vertices, { deletedVertexIds: new Set(['v2']) });
    expect(() => collectedSegments(segments, write)).not.toThrow();
    expect([...collectedSegments(segments, write)]).toEqual([]);
  });
});
