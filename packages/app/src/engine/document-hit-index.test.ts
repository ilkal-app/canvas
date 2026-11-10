import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import { hitPaletteOf, hitPoint } from '@canvas/engine';
import type { BoardObject, ObjectId, TokenValues } from '@canvas/schema';

import { DocumentHitIndex } from './document-hit-index.js';
import { connectorTargetUnder } from './document-tools.js';

const id = (value: string): ObjectId => value as ObjectId;

const SHARED = {
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 1,
  updatedAt: 1,
};

/**
 * A 100 × 50 rectangle.
 *
 * @param objectId - Its id.
 * @param x - Its left.
 * @param y - Its top.
 * @param fields - Fields to override.
 * @returns The object.
 */
function rectangle(
  objectId: string,
  x: number,
  y: number,
  fields: Record<string, unknown> = {},
): BoardObject {
  return {
    ...SHARED,
    id: id(objectId),
    x,
    y,
    z: `a${objectId}`,
    type: 'shape',
    kind: 'rectangle',
    width: 100,
    height: 50,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
    ...fields,
  } as BoardObject;
}

/**
 * A group.
 *
 * @param objectId - Its id.
 * @returns The group.
 */
function group(objectId: string): BoardObject {
  return {
    ...SHARED,
    id: id(objectId),
    x: 0,
    y: 0,
    z: `a${objectId}`,
    type: 'group',
  } as BoardObject;
}

/**
 * A straight connector between two objects, both automatic.
 *
 * @param from - The start's target.
 * @param to - The end's target.
 * @returns The connector.
 */
function link(from: string, to: string): BoardObject {
  return {
    ...SHARED,
    id: id('link'),
    x: 0,
    y: 0,
    z: 'az',
    type: 'connector',
    from: { kind: 'object', objectId: id(from), anchor: null },
    to: { kind: 'object', objectId: id(to), anchor: null },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'none',
    label: null,
  } as BoardObject;
}

/**
 * A store holding the objects, and an index following it.
 *
 * @param objects - The objects.
 * @returns The store, the index, and a hit test at a point.
 */
function setUp(...objects: BoardObject[]) {
  const store = new YjsDocumentStore({ clientId: 7 });
  write(store, ...objects);
  const hits = new DocumentHitIndex(store);
  const source = { get: (objectId: ObjectId) => hits.get(objectId) };
  const at = (x: number, y: number) => hitPoint(hits.index, source, { x, y }, { zoom: 1 });
  return { store, hits, at };
}

/**
 * Writes objects.
 *
 * @param store - The store.
 * @param objects - The objects.
 */
function write(store: YjsDocumentStore, ...objects: BoardObject[]): void {
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
}

describe('DocumentHitIndex', () => {
  it('lists the objects a world rectangle meets, with their drawn bounds', () => {
    const { hits, store } = setUp(rectangle('a', 0, 0), rectangle('b', 500, 0));
    const met = hits.objectsIn({ minX: -10, minY: -10, maxX: 200, maxY: 200 });
    expect(met.map((object) => object.id)).toEqual(['a']);
    expect(met[0]?.bounds.minX).toBeLessThanOrEqual(0);
    expect(met[0]?.bounds.maxX).toBeGreaterThanOrEqual(100);
    expect(hits.objectsIn({ minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 })).toEqual([]);
    write(store, rectangle('b', 50, 50));
    expect(
      hits
        .objectsIn({ minX: -10, minY: -10, maxX: 200, maxY: 200 })
        .map((object) => object.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('hides a descendant when an earlier store subscriber reads before the index subscriber (review)', () => {
    const store = new YjsDocumentStore({ clientId: 7 });
    write(store, group('g'), rectangle('child', 0, 0, { parentId: id('g') }));
    const index: { hits?: DocumentHitIndex } = {};
    let visibleDuringChange: BoardObject | undefined;
    store.subscribe(() => {
      visibleDuringChange = index.hits?.get(id('child'));
    });
    const hits = new DocumentHitIndex(store);
    index.hits = hits;

    write(store, { ...group('g'), isHidden: true } as BoardObject);

    expect(visibleDuringChange).toBeUndefined();
    expect(hits.get(id('child'))).toBeUndefined();
  });

  it('indexes and picks a connector by the route it draws between its targets', () => {
    // a's right side (100, 25) to b's left side (300, 25): its middle is (200, 25).
    const { at, hits } = setUp(rectangle('a', 0, 0), rectangle('b', 300, 0), link('a', 'b'));
    expect(at(200, 25)).toEqual(['link']);
    expect(hits.get(id('link'))).toMatchObject({ type: 'connector' });
    expect(hits.get(id('missing'))).toBeUndefined();
  });

  it('passes over a hidden layer and a hidden group’s children, and hits them once shown', () => {
    const { store, at } = setUp(
      rectangle('a', 0, 0, { isHidden: true }),
      { ...group('g'), isHidden: true } as BoardObject,
      rectangle('b', 300, 0, { parentId: id('g') }),
    );
    expect(at(50, 25)).toEqual([]);
    expect(at(350, 25)).toEqual([]);
    write(store, rectangle('a', 0, 0), group('g'));
    expect(at(50, 25)).toEqual(['a']);
    expect(at(350, 25)).not.toEqual([]);
  });

  it('re-indexes a connector when a target moves, though the connector is not written', () => {
    const { store, at } = setUp(rectangle('a', 0, 0), rectangle('b', 300, 0), link('a', 'b'));
    write(store, rectangle('b', 300, 200));
    // Now a's right (100, 25) to b's left (300, 225).
    expect(at(200, 25)).toEqual([]);
    expect(at(200, 125)).toEqual(['link']);
  });

  it('re-indexes a connector on a group when a child of the group moves, leaves or goes', () => {
    const { store, at } = setUp(
      rectangle('a', 0, 0),
      group('g'),
      rectangle('b', 300, 0, { parentId: id('g') }),
      rectangle('c', 300, 100, { parentId: id('g') }),
      link('a', 'g'),
    );
    // The group spans (300, 0) to (400, 150): from a's right (100, 25) to its left (300, 75).
    expect(at(200, 50)).toEqual(['link']);
    write(store, rectangle('c', 300, 0, { parentId: id('g') }));
    // Now the group is b's box: (100, 25) to (300, 25).
    expect(at(200, 25)).toEqual(['link']);
    write(store, rectangle('c', 300, 100, { parentId: id('g') }));
    expect(at(200, 50)).toEqual(['link']);
    write(store, rectangle('c', 300, 100));
    expect(at(200, 25)).toEqual(['link']);
    write(store, rectangle('c', 300, 100, { parentId: id('g') }));
    expect(at(200, 50)).toEqual(['link']);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject(id('c'));
    });
    expect(at(200, 25)).toEqual(['link']);
  });

  it('re-indexes a connector whose target sits in a frame that moves', () => {
    const frame = {
      ...SHARED,
      id: id('f'),
      x: 250,
      y: -100,
      z: 'a0',
      type: 'frame',
      width: 200,
      height: 200,
      name: 'Frame',
      clip: false,
      background: null,
    } as BoardObject;
    const { store, at } = setUp(
      frame,
      rectangle('a', 0, 0),
      rectangle('b', 50, 100, { parentId: id('f') }),
      link('a', 'b'),
    );
    expect(at(200, 25)).toEqual(['link']);
    write(store, { ...frame, y: 100 });
    expect(at(200, 25)).toEqual([]);
    expect(at(200, 125)).toEqual(['link']);
  });

  it('forgets a connector that is deleted, and stops following the store', () => {
    const { store, hits, at } = setUp(rectangle('a', 0, 0), rectangle('b', 300, 0), link('a', 'b'));
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject(id('link'));
    });
    expect(at(200, 25)).toEqual([]);
    hits.destroy();
    write(store, link('a', 'b'));
    expect(at(200, 25)).toEqual([]);
  });
});

describe('connectorTargetUnder', () => {
  it('is the topmost object under a point, never a connector or a frame’s open area', () => {
    const frame = {
      ...SHARED,
      id: id('f'),
      x: -50,
      y: -50,
      z: 'a0',
      type: 'frame',
      width: 600,
      height: 300,
      name: 'Frame',
      clip: false,
      background: [1, 1, 1, 1],
    } as BoardObject;
    const { hits } = setUp(frame, rectangle('a', 0, 0), rectangle('b', 300, 0), link('a', 'b'));
    const source = { get: (objectId: ObjectId) => hits.get(objectId) };
    const under = (x: number, y: number) => connectorTargetUnder(hits.index, source, { x, y }, 1);
    expect(under(50, 25)).toBe('a');
    expect(under(200, 25)).toBeUndefined();
    expect(under(200, 200)).toBeUndefined();
  });

  it('finds the objects drawn under a point, topmost first, by their exact geometry (idsAt)', () => {
    const { hits } = setUp(
      rectangle('1', 0, 0),
      rectangle('2', 50, 0),
      rectangle('3', 300, 0, { kind: 'ellipse' }),
    );
    expect(hits.idsAt({ x: 75, y: 25 }, 1)).toEqual([id('2'), id('1')]);
    expect(hits.idsAt({ x: 10, y: 25 }, 1)).toEqual([id('1')]);
    // Inside the ellipse's box but outside its painted curve: nothing.
    expect(hits.idsAt({ x: 302, y: 2 }, 1)).toEqual([]);
    expect(hits.idsAt({ x: 350, y: 25 }, 1)).toEqual([id('3')]);
  });

  it('reads colour tokens with the live palette: a transparent token fill is not hit (idsAt)', () => {
    const { hits } = setUp(
      rectangle('1', 0, 0),
      rectangle('2', 0, 0, { fill: { token: 'ghost' }, stroke: null }),
    );
    const source = { get: (objectId: ObjectId) => hits.get(objectId) };
    // Without the palette the token falls back to the built-ins, and the ghost covers '1'.
    expect(hits.idsAt({ x: 50, y: 25 }, 1)[0]).toBe(id('2'));
    const ghost = new Map<string, TokenValues>([
      ['ghost', { light: [0, 0, 0, 0], dark: [1, 0, 0, 1] }],
    ]);
    hits.usePalette(hitPaletteOf(source, { tokens: () => ghost, theme: () => 'light' }));
    expect(hits.idsAt({ x: 50, y: 25 }, 1)).toEqual([id('1')]);
  });
});
