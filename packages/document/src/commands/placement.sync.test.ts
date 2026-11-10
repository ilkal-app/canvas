import { describe, expect, it } from 'vitest';

import type { BoardObject, Point } from '@canvas/schema';

import { createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
  newShape,
  ORDERS,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, createFixtureStore, exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { boardPlacement } from './__fixtures__/board-geometry.js';
import { applyCommand, mustGet, NOW } from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { createObjectCommand } from './create-object.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';

// Placement is one group: `parentId`, `x`, `y` and `rotation`
// are written whole, so two clients that place one object concurrently (reparents into
// different frames, a reparent and a plain move, the reference repair and a user's move, the
// Case) keep exactly one client's placement, and the object never jumps by the offset
// between the two parents' frames. `z` keeps its own key and can come from the other client.

/** What a placement is made of: the parent and the position in its frame. */
type Placement = Pick<BoardObject, 'parentId' | 'x' | 'y' | 'rotation'>;

/**
 * Reads an object's placement.
 *
 * @param object - The object.
 * @returns Its parent, position and rotation.
 */
function placementOf(object: BoardObject): Placement {
  const { parentId, x, y, rotation } = object;
  return { parentId, x, y, rotation };
}

/**
 * Two stores holding the nested-frames board with fixed Yjs client ids, as two synced clients
 * would; the ids decide which concurrent write wins, so the tests run both orders.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @returns Ada's store and Bob's.
 */
function createPair(
  adaClientId: number,
  bobClientId: number,
): [YjsDocumentStore, YjsDocumentStore] {
  const board = createNestedFramesStore().encodeState();
  const ada = new YjsDocumentStore({ clientId: adaClientId });
  const bob = new YjsDocumentStore({ clientId: bobClientId });
  ada.applyUpdate(board, RELAY);
  bob.applyUpdate(board, RELAY);
  return [ada, bob];
}

/**
 * Checks that the merged object holds one client's placement exactly, and sits on the board
 * where that client put it.
 *
 * @param merged - The store after the merge.
 * @param objectId - The object.
 * @param candidates - Each client's placement and board position before the merge.
 */
function expectOneWholePlacement(
  merged: YjsDocumentStore,
  objectId: string,
  candidates: readonly { placement: Placement; onBoard: readonly [Point, Point] }[],
): void {
  const object = mustGet(merged, objectId);
  const winner = candidates.find(({ placement }) => {
    const actual = placementOf(object);
    return JSON.stringify(actual) === JSON.stringify(placement);
  });
  expect(winner, 'the merged placement is one client’s, whole').toBeDefined();
  const onBoard = boardPlacement(merged.read(), objectId);
  onBoard.forEach((point, index) => {
    expect(point.x).toBeCloseTo(winner?.onBoard[index]?.x ?? Number.NaN, 9);
    expect(point.y).toBeCloseTo(winner?.onBoard[index]?.y ?? Number.NaN, 9);
  });
}

/**
 * Records where a store holds an object: its placement and its position on the board.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @returns The placement and board position.
 */
function recordPlacement(
  store: YjsDocumentStore,
  objectId: string,
): { placement: Placement; onBoard: readonly [Point, Point] } {
  return {
    placement: placementOf(mustGet(store, objectId)),
    onBoard: boardPlacement(store.read(), objectId),
  };
}

/**
 * Runs the race: Ada deletes the frame while Bob, apart from her, creates c in it and
 * then moves it; Ada's client repairs c when it gets the creation, concurrently with Bob's move.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @returns Where c ends up on the board, and where Bob's creation and move put it.
 */
function raceRepairAndMove(
  adaClientId: number,
  bobClientId: number,
): {
  onBoard: readonly [Point, Point];
  created: readonly [Point, Point];
  moved: readonly [Point, Point];
} {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  const link = new Link(ada, bob);
  link.disconnect();
  applyCommand(ada, deleteObjectsCommand, { ids: ['frame-plan'] });
  applyCommand(
    bob,
    createObjectCommand,
    { object: newShape('shape-c', 'frame-plan', 40) },
    BOB,
    BOB_ENVIRONMENT,
  );
  const created = boardPlacement(bob.read(), 'shape-c');
  applyCommand(bob, moveObjectsCommand, { moves: [{ id: 'shape-c', by: { x: 30, y: 20 } }] }, BOB, {
    ...BOB_ENVIRONMENT,
    clock: () => NOW + 1_000,
  });
  const moved = boardPlacement(bob.read(), 'shape-c');
  link.reconnect();
  expectValidAndConverged(ada, bob);
  expect(mustGet(ada, 'shape-c').parentId).toBeNull();
  return { onBoard: boardPlacement(ada.read(), 'shape-c'), created, moved };
}

/**
 * Tells whether two board placements are the same, to 1e-9.
 *
 * @param first - One placement.
 * @param second - The other.
 * @returns `true` when every point matches.
 */
function isSamePlace(first: readonly [Point, Point], second: readonly [Point, Point]): boolean {
  return first.every(
    (point, index) =>
      Math.abs(point.x - (second[index]?.x ?? Number.NaN)) < 1e-9 &&
      Math.abs(point.y - (second[index]?.y ?? Number.NaN)) < 1e-9,
  );
}

describe.each(ORDERS)('concurrent placements ($name)', ({ adaClientId, bobClientId }) => {
  it('keep one of two reparents into different frames, whole, and never jump', () => {
    const [ada, bob] = createPair(adaClientId, bobClientId);
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-free', to: { x: 200, y: 150 }, parentId: 'frame-outer' }],
    });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'rect-free', to: { x: 900, y: 100 }, parentId: 'frame-side' }] },
      BOB,
    );
    const candidates = [recordPlacement(ada, 'rect-free'), recordPlacement(bob, 'rect-free')];
    expect(candidates.map(({ placement }) => placement.parentId)).toEqual([
      'frame-outer',
      'frame-side',
    ]);
    exchange(ada, bob);
    expectValidAndConverged(ada, bob);
    expectOneWholePlacement(ada, 'rect-free', candidates);
  });

  it('keep either a reparent or a plain move of one object, whole, and never jump', () => {
    const [ada, bob] = createPair(adaClientId, bobClientId);
    applyCommand(ada, moveObjectsCommand, {
      moves: [{ id: 'rect-outer', by: { x: 500, y: 0 }, parentId: null }],
    });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'rect-outer', by: { x: 10, y: 10 } }] },
      BOB,
    );
    const candidates = [recordPlacement(ada, 'rect-outer'), recordPlacement(bob, 'rect-outer')];
    exchange(ada, bob);
    expectValidAndConverged(ada, bob);
    expectOneWholePlacement(ada, 'rect-outer', candidates);
  });

  it('keep the repair’s placement or the user’s move, repaired where the user put it', () => {
    const { onBoard, created, moved } = raceRepairAndMove(adaClientId, bobClientId);
    // At the root, where Bob's creation or his move put it on the board, never elsewhere.
    expect([created, moved].filter((place) => isSamePlace(place, onBoard))).toHaveLength(1);
  });
});

describe('the reference repair racing a user’s move', () => {
  it('re-runs when the user’s placement wins and dangles, from the user’s position', () => {
    const outcomes = ORDERS.map(({ adaClientId, bobClientId }) => {
      const { onBoard, moved } = raceRepairAndMove(adaClientId, bobClientId);
      return isSamePlace(moved, onBoard);
    });
    // One merge order keeps the repair's write, the other Bob's move, repaired again.
    expect(outcomes.sort()).toEqual([false, true]);
  });
});

/**
 * Collects a store's local updates from now on.
 *
 * @param store - The store.
 * @returns The list the updates are pushed to, emptied by {@link deliverTo}.
 */
function localUpdatesOf(store: YjsDocumentStore): Uint8Array[] {
  const updates: Uint8Array[] = [];
  store.subscribeUpdates(({ update, isLocal }) => {
    if (isLocal) updates.push(update);
  });
  return updates;
}

/**
 * Applies collected updates to a store, in order, and empties nothing (a peer may get them too).
 *
 * @param store - The receiving store.
 * @param updates - The updates.
 */
function deliverTo(store: YjsDocumentStore, updates: readonly Uint8Array[]): void {
  for (const update of updates) store.applyUpdate(update, RELAY);
}

/**
 * The three-client orders: Carol's repair loses to Bob's move (her client id, 0, is below his),
 * in both of Ada's and Bob's orders, or wins (her id is the highest).
 */
const THREE_CLIENT_ORDERS = [
  ...ORDERS.map((order) => ({ ...order, carolClientId: 0, isRepairKept: false })),
  {
    name: "Carol's client id above both",
    adaClientId: 1,
    bobClientId: 2,
    carolClientId: 3,
    isRepairKept: true,
  },
] as const;

describe.each(THREE_CLIENT_ORDERS)(
  'three clients, repair against a move ($name)',
  ({ adaClientId, bobClientId, carolClientId, isRepairKept }) => {
    it('keep the repair or the move whole when the move reaches the mover after the repair', () => {
      // Ada deletes the frame. Bob, apart from her, creates c in it. Carol gets both and repairs
      // c to the root. Bob, still without Ada's delete, moves c in the frame, then gets Carol's
      // repair; whichever of their placements wins (by client id) is kept whole. With
      // `parentId` on its own key, Carol's root parent stayed with Bob's position in the frame's
      // coordinates, and c jumped by the frame's offset on every client with nothing left
      // dangling to repair; with one placement group, when Bob's placement wins, its parent is
      // gone and the repair runs from his position, and when Carol's wins, c stays where she put
      // it.
      const fixture = createFixtureStore().encodeState();
      const [ada, bob, carol] = [adaClientId, bobClientId, carolClientId].map((clientId) => {
        const store = new YjsDocumentStore({ clientId });
        store.applyUpdate(fixture, RELAY);
        return store;
      }) as [YjsDocumentStore, YjsDocumentStore, YjsDocumentStore];
      const [fromAda, fromBob, fromCarol] = [ada, bob, carol].map(localUpdatesOf) as [
        Uint8Array[],
        Uint8Array[],
        Uint8Array[],
      ];
      applyCommand(ada, deleteObjectsCommand, { ids: ['frame-plan'] });
      applyCommand(
        bob,
        createObjectCommand,
        { object: newShape('shape-c', 'frame-plan', 40) },
        BOB,
        BOB_ENVIRONMENT,
      );
      const created = boardPlacement(bob.read(), 'shape-c');
      deliverTo(carol, fromBob);
      deliverTo(carol, fromAda);
      expect(mustGet(carol, 'shape-c').parentId).toBeNull();
      const sentByBob = fromBob.length;
      applyCommand(
        bob,
        moveObjectsCommand,
        { moves: [{ id: 'shape-c', by: { x: 30, y: 20 } }] },
        BOB,
        { ...BOB_ENVIRONMENT, clock: () => NOW + 1_000 },
      );
      const moved = boardPlacement(bob.read(), 'shape-c');
      deliverTo(bob, fromCarol);
      // Ada gets Carol's repair before Bob's creation, so she has nothing to repair herself.
      deliverTo(ada, fromCarol);
      deliverTo(ada, fromBob);
      deliverTo(carol, fromBob.slice(sentByBob));
      for (const [first, second] of [
        [ada, bob],
        [bob, carol],
        [ada, carol],
        [ada, bob],
      ] as const) {
        exchange(first, second);
      }
      expectValidAndConverged(ada, bob);
      expectValidAndConverged(bob, carol);
      const onBoard = boardPlacement(ada.read(), 'shape-c');
      expect([created, moved].filter((place) => isSamePlace(place, onBoard))).toHaveLength(1);
      expect(isSamePlace(isRepairKept ? created : moved, onBoard)).toBe(true);
    });
  },
);
