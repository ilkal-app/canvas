// Item 4: the board's bound (B = 2^30, BOUND_SLACK = 2^-40) holds an object's
// placement, its origin on the board, as well as its extent, so a command can no longer store an
// object with no geometry of its own (an empty group) far away: before, moving one by 1e308 stored
// x = 1e308 and the bound saw nothing to judge. Stored coordinates stay unbounded (rule 2): a
// command still stores a number past ±2^31 where the place on the board it means is inside.
import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, objectToBoardTransform, type ObjectId } from '@canvas/schema';

import { boxSourceOf } from '../bound/box-source.js';
import { isFarObject } from '../bound/far-object.js';
import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { expectInvalidInput, frameAt } from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { judgedAtDoor } from './__fixtures__/door-judgement.js';
import { createObjectCommand } from './create-object.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import { rotateObjectsCommand } from './rotate-objects.js';

const B = BOARD_BOUND;

/**
 * A store holding an empty group at (10, 10).
 *
 * @returns The store.
 */
function emptyGroupStore(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  applyCommand(store, createObjectCommand, {
    object: { id: 'empty', type: 'group', x: 10, y: 10 },
  });
  return store;
}

describe('an object with no geometry of its own is bounded by its placement', () => {
  it('refuses moving an empty group by 1e308, or to one unit past the bound', () => {
    const store = emptyGroupStore();
    for (const move of [{ by: { x: 1e308, y: 0 } }, { to: { x: 0, y: -B - 1 } }]) {
      const errors = expectInvalidInput(store, moveObjectsCommand, {
        moves: [{ id: 'empty', ...move }],
      });
      expect(errors.map(({ objectId }) => objectId)).toEqual(['empty']);
    }
  });

  it('moves an empty group anywhere inside the bound, to the bound itself', () => {
    const store = emptyGroupStore();
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'empty', to: { x: B, y: -B } }] });
    expect(mustGet(store, 'empty')).toMatchObject({ x: B, y: -B });
  });

  it('refuses creating an empty group past the bound', () => {
    const store = new YjsDocumentStore();
    expectInvalidInput(store, createObjectCommand, {
      object: { id: 'far', type: 'group', x: B + 1, y: 0 },
    });
  });

  it('lets an empty group a peer left far come inward or go, never further out; it is far', () => {
    const store = emptyGroupStore();
    const peer = new YjsDocumentStore();
    peer.applyUpdate(store.encodeState(), RELAY);
    peer.transact(RELAY, (transaction) => {
      transaction.patchObject('empty' as ObjectId, { x: 1e300 });
    });
    store.applyUpdate(peer.encodeState(store.encodeStateVector()), RELAY);
    expect(isFarObject(boxSourceOf(store), 'empty' as ObjectId)).toBe(true);
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'empty', by: { x: 1e299, y: 0 } }],
    });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'empty', to: { x: 0, y: 0 } }] });
    expect(isFarObject(boxSourceOf(store), 'empty' as ObjectId)).toBe(false);
    applyCommand(store, deleteObjectsCommand, { ids: ['empty'] });
    expect(store.get('empty' as ObjectId)).toBeUndefined();
  });

  it('refuses a turn that carries a group origin past the bound while its members stay', () => {
    const store = emptyGroupStore();
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'empty', to: { x: B - 10, y: 0 } }] });
    expectInvalidInput(store, rotateObjectsCommand, {
      rotations: [{ id: 'empty', by: Math.PI, about: { x: -10, y: 0 } }],
    });
  });
});

describe('a command still stores a coordinate past ±2^31 where its place is inside the bound', () => {
  it('a child of a frame turned 45° at one corner, placed at the opposite corner, stores 2√2 × B', () => {
    const store = new YjsDocumentStore();
    const far = B - 1_000;
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(-far, -far), id: 'tilted', rotation: Math.PI / 4 },
    });
    const { findings } = judgedAtDoor(store, () =>
      applyCommand(store, createObjectCommand, {
        object: { ...frameAt(Math.SQRT2 * 2 * far, 0), id: 'child', parentId: 'tilted' },
      }),
    );
    const child = mustGet(store, 'child');
    expect(child.x).toBeGreaterThan(2 ** 31);
    const placed = objectToBoardTransform(store.read(), child);
    expect(Math.abs(placed.x)).toBeLessThanOrEqual(B);
    expect(Math.abs(placed.y)).toBeLessThanOrEqual(B);
    expect(findings).toEqual([]);
  });

  it('a child moved inside the bound out of a parent a peer left far stores about the parent', () => {
    const store = new YjsDocumentStore();
    applyCommand(store, createObjectCommand, { object: { ...frameAt(0, 0), id: 'parent' } });
    applyCommand(store, createObjectCommand, {
      object: { ...frameAt(10, 10), id: 'child', parentId: 'parent' },
    });
    const peer = new YjsDocumentStore();
    peer.applyUpdate(store.encodeState(), RELAY);
    peer.transact(RELAY, (transaction) => {
      transaction.patchObject('parent' as ObjectId, { x: 1e15 });
    });
    store.applyUpdate(peer.encodeState(store.encodeStateVector()), RELAY);
    const { findings } = judgedAtDoor(store, () =>
      applyCommand(store, moveObjectsCommand, { moves: [{ id: 'child', to: { x: 0, y: 0 } }] }),
    );
    expect(mustGet(store, 'child')).toMatchObject({ parentId: 'parent', x: -1e15 });
    expect(findings).toEqual([]);
  });
});
