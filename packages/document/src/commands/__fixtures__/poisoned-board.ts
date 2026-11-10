import * as Y from 'yjs';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { ADA, BODY, fixtureObject, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../../store/yjs-document-store.js';

// A board holding one shape a peer left with one invalid field (item 1), written raw by
// a real remote update, as a peer that skips validation (or wrote before the relay's door
// existed) leaves it: the shape `box` at the root, beside a frame `frame` to reparent into and a
// shape `top` stacked above it.

/** One invalid field a peer leaves on `box`, written into its stored map. */
export interface Poison {
  /** What it is, for a test name. */
  readonly name: string;
  /** The schema field it breaks. */
  readonly field: 'width' | 'rotation' | 'stroke';
  /** Writes the invalid value into the shape's map, in the peer's document. */
  readonly write: (map: Y.Map<unknown>) => void;
}

/**
 * Merges fields into a stored group, as a peer writes it.
 *
 * @param map - The object's map.
 * @param key - The group's key.
 * @param fields - The fields to set.
 */
function mergeGroup(map: Y.Map<unknown>, key: string, fields: Record<string, unknown>): void {
  map.set(key, { ...(map.get(key) as Record<string, unknown>), ...fields });
}

/** The three invalid untouched fields of item 2: a value, a non-finite number, a nested kind. */
export const POISONS: readonly Poison[] = [
  {
    name: 'a negative width',
    field: 'width',
    write: (map) => {
      mergeGroup(map, 'size', { width: -5 });
    },
  },
  {
    name: 'a NaN rotation',
    field: 'rotation',
    write: (map) => {
      mergeGroup(map, 'placement', { rotation: Number.NaN });
    },
  },
  {
    name: 'a wrong-kind nested style value',
    field: 'stroke',
    write: (map) => {
      // `'ink'` is a colour since; a token of another case is not.
      mergeGroup(map, 'style', { stroke: { color: 'Ink', width: 2 } });
    },
  },
];

/**
 * The clean board: `frame` and `box` at the root, `top` above `box`.
 *
 * @returns Its objects.
 */
export function cleanObjects(): BoardObject[] {
  const shape = fixtureObject('shape-box', 'shape');
  const star = fixtureObject('shape-star', 'shape');
  const frame = fixtureObject('frame-plan', 'frame');
  return [
    { ...frame, id: 'frame' as ObjectId, x: 600, y: 0, z: 'a0' },
    {
      ...shape,
      id: 'box' as ObjectId,
      parentId: null,
      x: 100,
      y: 100,
      z: 'a1',
      label: { text: 'API', runs: [{ length: 3, style: BODY }] },
    },
    { ...star, id: 'top' as ObjectId, parentId: null, x: 300, y: 100, z: 'a2', locked: false },
  ];
}

/**
 * A store holding the clean board, then a peer's raw update that poisons `box`.
 *
 * @param poison - What the peer breaks, or `undefined` for the clean board.
 * @returns The store.
 */
export function poisonedStore(poison: Poison | undefined): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of cleanObjects()) transaction.setObject(object);
  });
  if (poison === undefined) return store;
  const peer = new Y.Doc();
  Y.applyUpdate(peer, store.encodeState());
  peer.transact(() => {
    const map = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get('box');
    if (map === undefined) throw new Error('no box to poison');
    poison.write(map);
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
  peer.destroy();
  return store;
}
