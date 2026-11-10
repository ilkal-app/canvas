import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type ObjectId } from '@canvas/schema';

import {
  readStoredEntry,
  writeStoredEntriesRemotely,
} from '../store/__fixtures__/remote-values.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { expectInvalidInput } from './__fixtures__/bound-fixtures.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { groupCommand } from './group.js';
import { moveObjectsCommand } from './move-objects.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { rotateObjectsCommand } from './rotate-objects.js';
import { setLinePointsCommand } from './set-line-points.js';

// Fix round 3: THE BOUND IS ON WORLD GEOMETRY. For every object a command changes or
// carries, each of the four extents of its axis-aligned box on the board (rotation applied; a
// line's or path's points) obeys |after| <= max(B, |before|). Stored, parent-relative numbers are
// not bounded. The failing sequences of the round-2 re-review (N1, N2, N4) and the minor on
// re-rooting are each a test here.

const B = BOARD_BOUND;

/**
 * A rectangle as `createObject` takes it.
 *
 * @param id - Its id.
 * @param x - Its x in its parent's frame.
 * @param y - Its y.
 * @param size - Its width and height, world units.
 * @param parentId - Its parent; the root by default.
 * @returns The new object's fields.
 */
function rectangle(
  id: string,
  x: number,
  y: number,
  size: Readonly<Record<'width' | 'height', number>>,
  parentId: string | null = null,
) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    type: 'shape' as const,
    kind: 'rectangle' as const,
    x,
    y,
    width: size.width,
    height: size.height,
    stroke: null,
    fill: null,
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A 0-size frame as `createObject` takes it.
 *
 * @param id - Its id.
 * @param x - Its x.
 * @returns The new object's fields.
 */
function point(id: string, x: number) {
  return {
    id: id as ObjectId,
    type: 'frame' as const,
    x,
    y: 0,
    width: 0,
    height: 0,
    name: id,
    clip: false,
    background: null,
  };
}

/**
 * A store holding the given new objects, created one by one.
 *
 * @param objects - The objects, parents first.
 * @returns The store.
 */
function storeWith(...objects: readonly object[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  for (const object of objects) {
    applyCommand(store, createObjectCommand, { object } as never);
  }
  return store;
}

/**
 * Stores placement fields on an object as a peer that skips validation would.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @param fields - The placement fields to set.
 */
function placeRaw(
  store: YjsDocumentStore,
  objectId: string,
  fields: Readonly<Record<string, number>>,
): void {
  const placement = readStoredEntry(store, objectId, 'placement') as object;
  writeStoredEntriesRemotely(store, objectId, { placement: { ...placement, ...fields } });
}

describe('N1: an existing object is judged by its box on the board', () => {
  it('a far box resized about an origin cannot carry its far edge further out', () => {
    const store = storeWith(rectangle('s', 0, 0, { width: 100, height: 50 }));
    placeRaw(store, 's', { x: B + 400 });
    // x goes inward (B + 300), but the far edge would go from B + 500 to B + 600.
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 's', to: { width: 300, height: 50 }, origin: { x: B + 300, y: 0 } }],
    });
    // Both edges inward is accepted: B + 300 to B + 350.
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 's', to: { width: 50, height: 50 }, origin: { x: B + 300, y: 0 } }],
    });
    expect(mustGet(store, 's')).toMatchObject({ x: B + 300, width: 50 });
  });

  it('an honest box cannot be resized past the bound', () => {
    const store = storeWith(rectangle('s', B - 100, 0, { width: 100, height: 50 }));
    expectInvalidInput(store, resizeObjectsCommand, {
      resizes: [{ id: 's', to: { width: 1e6, height: 50 } }],
    });
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 's', to: { width: 60, height: 50 } }],
    });
  });

  it('a turn cannot carry a corner out, one that keeps the corners in is accepted', () => {
    const store = storeWith(rectangle('s', B - 100, 0, { width: 100, height: 100 }));
    // Turned by -π/4 about its top-left corner, its bottom-right corner reaches B + 41.
    expectInvalidInput(store, rotateObjectsCommand, {
      rotations: [{ id: 's', by: -Math.PI / 4 }],
    });
    applyCommand(store, rotateObjectsCommand, { rotations: [{ id: 's', by: Math.PI / 4 }] });
  });

  it('a group move cannot carry a member out; along the other axis it moves', () => {
    const store = storeWith(point('left', -B), point('right', B));
    applyCommand(store, groupCommand, { ids: ['left', 'right'], groupId: 'g' });
    expectInvalidInput(store, moveObjectsCommand, { moves: [{ id: 'g', by: { x: 10, y: 0 } }] });
    expectInvalidInput(store, moveObjectsCommand, { moves: [{ id: 'g', by: { x: -10, y: 0 } }] });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'g', by: { x: 0, y: 10 } }] });
    expect(mustGet(store, 'g')).toMatchObject({ y: 10 });
  });

  it('a member stored 2B from its group moves by where it is on the board', () => {
    const store = storeWith(point('left', -B), point('right', B - 100));
    applyCommand(store, groupCommand, { ids: ['left', 'right'], groupId: 'g' });
    expect(mustGet(store, 'right').x).toBe(2 * B - 100);
    // On the board it is at B - 100: +50 lands it at B - 50.
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'right', by: { x: 50, y: 0 } }] });
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'right', to: { x: B - 30, y: 0 } }],
    });
    expect(mustGet(store, 'right').x).toBe(2 * B - 30);
    expectInvalidInput(store, moveObjectsCommand, {
      moves: [{ id: 'right', to: { x: B + 1, y: 0 } }],
    });
  });

  it('a line end is dragged to a board point inside, whatever the line stores', () => {
    const store = storeWith({
      id: 'l',
      type: 'line',
      x: -B,
      y: 0,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      stroke: { color: [0, 0, 0, 1], width: 2 },
      startCap: 'none',
      endCap: 'none',
      route: 'straight',
    });
    applyCommand(store, setLinePointsCommand, { id: 'l', end: 1, point: { x: B, y: 0 } });
    expect(mustGet(store, 'l')).toMatchObject({ points: [{ x: 0 }, { x: 2 * B }] });
    expectInvalidInput(store, setLinePointsCommand, {
      id: 'l',
      end: 1,
      point: { x: B + 1, y: 0 },
    });
  });
});

describe('N2: a pivot, an origin or a displacement is a plain finite point', () => {
  it('a turn about a pivot past the bound is judged by where the object lands', () => {
    const store = storeWith(rectangle('s', B - 200, 0, { width: 10, height: 10 }));
    applyCommand(store, rotateObjectsCommand, {
      rotations: [{ id: 's', by: 0.001, about: { x: B + 40, y: 5 } }],
    });
  });

  it('a move by more than B from one edge to the other is accepted', () => {
    const store = storeWith(rectangle('s', -B, 0, { width: 10, height: 10 }));
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 's', by: { x: 2 * B - 20, y: 0 } }] });
    expect(mustGet(store, 's').x).toBe(B - 20);
  });
});

describe('an honest person is never stuck with a far object', () => {
  it('a child of a far group moved to a board point inside lands there, re-rooted', () => {
    const store = storeWith(
      { id: 'g', type: 'group', x: 0, y: 0 },
      rectangle('child', 10, 10, { width: 5, height: 5 }, 'g'),
    );
    placeRaw(store, 'g', { x: 1e300 });
    const { result } = applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'child', to: { x: 10, y: 10 } }],
    });
    expect(mustGet(store, 'child')).toMatchObject({ parentId: null, x: 10, y: 10 });
    expect(result).toMatchObject({ rerootedIds: ['child'] });
  });

  it('a child under an ancestor that is not finite is moved inside, re-rooted', () => {
    const store = storeWith(
      { id: 'g', type: 'group', x: 0, y: 0 },
      rectangle('child', 10, 10, { width: 5, height: 5 }, 'g'),
    );
    placeRaw(store, 'g', { x: Number.POSITIVE_INFINITY });
    const { result } = applyCommand(store, moveObjectsCommand, {
      moves: [{ id: 'child', to: { x: 20, y: 30 } }],
    });
    expect(mustGet(store, 'child')).toMatchObject({ parentId: null, x: 20, y: 30 });
    expect(result).toMatchObject({ rerootedIds: ['child'] });
  });

  it('a far object is deleted', () => {
    const store = storeWith(rectangle('s', 0, 0, { width: 5, height: 5 }));
    placeRaw(store, 's', { x: 1e300 });
    applyCommand(store, deleteObjectsCommand, { ids: ['s'] });
    expect(store.get('s' as ObjectId)).toBeUndefined();
  });
});

describe('N4: paste and duplicate refuse what createObject refuses', () => {
  const create = (object: object) => ({ objects: [object] }) as never;

  it('a comment pin offset past its limit', () => {
    const store = storeWith(rectangle('s', 0, 0, { width: 5, height: 5 }));
    const comment = {
      type: 'comment',
      x: 0,
      y: 0,
      threadId: 'thread-1',
      anchor: { kind: 'object', objectId: 's', offset: { x: 1e300, y: 0 } },
    };
    expectInvalidInput(store, createObjectCommand, { object: comment });
    expectInvalidInput(store, createObjectsCommand, create(comment));
  });

  it('a corner radius past its limit', () => {
    const store = new YjsDocumentStore();
    const shape = { ...rectangle('s', 0, 0, { width: 5, height: 5 }), cornerRadius: 2 ** 31 };
    expectInvalidInput(store, createObjectCommand, { object: shape });
    expectInvalidInput(store, createObjectsCommand, create(shape));
  });
});
