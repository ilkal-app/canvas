import { bench, describe } from 'vitest';
import * as Y from 'yjs';

import type { BoardObject, BoardObjectOf, ObjectId } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { LastKnownBoard } from './last-known-board.js';
import { planReferenceRepair } from './reference-repair.js';

// The reference repair runs after every remote update, so it sits on the path of the
// budget "no frame > 33 ms during a drag with remote motion". Two measurements on the
// seeded 50k-object board: (1) applying one remote move, the common case, where the
// repair only checks the moved object's references; (2) planning the repair of a remote delete
// of a group whose CHILD_COUNT children a peer had meanwhile kept in it, with a connector to
// every twentieth child. (3) Loading the whole board, with the repair's check and without it
// (the same decode, through the store's Yjs document directly, so no repair runs), and the
// check alone over every created object, which isolates the check's share of a load.
// CI's smoke run (`BENCH_SMOKE=1`) uses 2k objects and 100 children.

const BOARD_SIZE = benchSize({ full: 50_000, smoke: 2_000 });
const CHILD_COUNT = benchSize({ full: 1_000, smoke: 100 });
const MOVE_COUNT = 200;
const GROUP_ID = 'bench-orphaning-group' as ObjectId;

const boardObjects = createLargeBoardObjects(BOARD_SIZE - CHILD_COUNT - 1, 46);

/**
 * A group of shapes, each twentieth with a connector attached from outside.
 *
 * @returns The group, its children and the connectors.
 */
function orphanedGroup(): BoardObject[] {
  const shape = fixtureObject('shape-box', 'shape');
  const connector = fixtureObject('connector-flow', 'connector');
  const children = [...Array(CHILD_COUNT).keys()].map((child): BoardObject => ({
    ...shape,
    id: `bench-child-${String(child)}` as ObjectId,
    parentId: GROUP_ID,
    x: (child % 40) * 200,
    z: `c${String(child).padStart(3, '0')}`,
  }));
  const connectors = children
    .filter((child, index) => index % 20 === 0)
    .map((child): BoardObject => ({
      ...connector,
      id: `bench-connector-${child.id}` as ObjectId,
      from: { kind: 'object', objectId: child.id, anchor: null },
      to: { kind: 'object', objectId: GROUP_ID, anchor: null },
    }));
  const group = { ...fixtureObject('group-diagram', 'group'), id: GROUP_ID, parentId: null };
  return [group, ...children, ...connectors];
}

// (1) A peer moves objects; each move is one update this store applies.
const peer = new YjsDocumentStore();
peer.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of boardObjects) transaction.setObject(object);
});
const loadState = peer.encodeState();
const local = new YjsDocumentStore();
local.applyUpdate(loadState, SYSTEM_ORIGIN);
local.read();
const moves: Uint8Array[] = [];
peer.subscribeUpdates(({ update }) => moves.push(update));
for (const object of boardObjects.slice(0, MOVE_COUNT)) {
  peer.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.patchObject(object.id, { x: object.x + 1 });
  });
}
let nextMove = 0;

// (2) The group is deleted while its children stay: a merge's state, written locally so the
// store does not repair it.
const orphaned = new YjsDocumentStore();
orphaned.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of [...boardObjects, ...orphanedGroup()]) transaction.setObject(object);
});
orphaned.read();
orphaned.transact(SYSTEM_ORIGIN, (transaction) => transaction.deleteObject(GROUP_ID));
const { lastKnown, objects } = internalsOf(orphaned);
const view = {
  get: (id: ObjectId) => orphaned.get(id),
  isPresent: (id: ObjectId) => objects.has(id),
};
const before = new LastKnownBoard(orphaned, lastKnown);

// (3) The check alone, over every object of a loaded board.
const loadedIds = new Set(local.read().objects.keys());
const localInternals = internalsOf(local);
const localView = {
  get: (id: ObjectId) => local.get(id),
  isPresent: (id: ObjectId) => localInternals.objects.has(id),
};
/** A whole-board load, measured a few times: each iteration builds a 50k-object store. */
const LOAD = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 };

describe(`reference repair on a ${String(BOARD_SIZE)}-object board`, () => {
  bench(
    'applyUpdate of one remote move, repair check included',
    () => {
      const update = moves[nextMove];
      nextMove += 1;
      if (update === undefined) throw new Error('out of moves');
      local.applyUpdate(update, SYSTEM_ORIGIN);
    },
    // Fewer iterations than moves: the runner may call the function once more to warm up.
    { time: 0, iterations: MOVE_COUNT - 3, warmupTime: 0, warmupIterations: 0 },
  );

  bench(`plan the repair of a deleted group's ${String(CHILD_COUNT)} children`, () => {
    const plan = planReferenceRepair(view, before, [GROUP_ID]);
    if (plan.updated.length < CHILD_COUNT) throw new Error('nothing planned');
  });

  bench(
    'load, check on: applyUpdate (decode and reference check), then read()',
    () => {
      const store = new YjsDocumentStore();
      store.applyUpdate(loadState, SYSTEM_ORIGIN);
      store.read();
    },
    LOAD,
  );

  bench(
    'load, check off: the same update into the Yjs document directly, then read() (decode)',
    () => {
      const store = new YjsDocumentStore();
      Y.applyUpdate(internalsOf(store).doc, loadState, SYSTEM_ORIGIN);
      store.read();
    },
    LOAD,
  );

  bench('the reference check alone, over every object of a loaded board', () => {
    planReferenceRepair(localView, new LastKnownBoard(local, localInternals.lastKnown), loadedIds);
  });
});

// (4) Large paths: a peer moves PATH_COUNT paths of PATH_SEGMENTS segments each in one
// update, or edits one vertex of one of them. The repair runs after each update; neither breaks
// a network, so the repair should cost next to nothing beside the decode of the paths the update
// changed. The same sizes in the smoke run: 100k segments fit a runner's heap.
const PATH_COUNT = 100;
const PATH_SEGMENTS = 1_000;
const PATH_UPDATES = 40;

/**
 * An open chain of `PATH_SEGMENTS` straight segments.
 *
 * @param index - Which path.
 * @returns The path.
 */
function largePath(index: number): BoardObjectOf<'path'> {
  const vertices = [...Array(PATH_SEGMENTS + 1).keys()].map((vertex) => ({
    id: `vertex-${String(vertex)}-of-path-${String(index)}`,
    x: vertex * 10,
    y: (vertex % 7) * 5,
    mirror: 'none' as const,
  }));
  const segments = vertices.slice(1).map((vertex, segment) => ({
    id: `segment-${String(segment)}-of-path-${String(index)}`,
    a: vertices[segment]?.id ?? '',
    b: vertex.id,
    ha: { x: 0, y: 0 },
    hb: { x: 0, y: 0 },
  }));
  const path = fixtureObject('path-squiggle', 'path');
  return { ...path, id: `bench-path-${String(index)}` as ObjectId, vertices, segments };
}

const pathPeer = new YjsDocumentStore();
const paths = [...Array(PATH_COUNT).keys()].map(largePath);
pathPeer.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const path of paths) transaction.setObject(path);
});
const pathState = pathPeer.encodeState();
const pathLocal = new YjsDocumentStore();
pathLocal.applyUpdate(pathState, SYSTEM_ORIGIN);
pathLocal.read();
// The edits come from a second peer, so they do not wait on moves the bench never applies.
const editPeer = new YjsDocumentStore();
editPeer.applyUpdate(pathState, SYSTEM_ORIGIN);
const pathMoves: Uint8Array[] = [];
const pathEdits: Uint8Array[] = [];
pathPeer.subscribeUpdates(({ update }) => pathMoves.push(update));
editPeer.subscribeUpdates(({ update }) => pathEdits.push(update));
for (let step = 1; step <= PATH_UPDATES; step += 1) {
  pathPeer.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const path of paths) transaction.patchObject(path.id, { x: path.x + step });
  });
}
const [editedPath] = paths;
const [firstVertex, ...otherVertices] = editedPath?.vertices ?? [];
if (editedPath === undefined || firstVertex === undefined) throw new Error('no path to edit');
for (let step = 1; step <= PATH_UPDATES; step += 1) {
  editPeer.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.patchObject(editedPath.id, {
      vertices: [{ ...firstVertex, y: step }, ...otherVertices],
    });
  });
}
const pathInternals = internalsOf(pathLocal);
const pathView = {
  get: (id: ObjectId) => pathLocal.get(id),
  isPresent: (id: ObjectId) => pathInternals.objects.has(id),
};
const pathIds = paths.map(({ id }) => id);
let nextPathMove = 0;
let nextPathEdit = 0;
/** One pass over the prepared updates: each is applied once. */
const PATH_RUN = { time: 0, iterations: PATH_UPDATES - 3, warmupTime: 0, warmupIterations: 0 };

describe(`remote updates of ${String(PATH_COUNT)} paths of ${String(PATH_SEGMENTS)} segments`, () => {
  bench(
    'applyUpdate of one remote move of every path, repair included',
    () => {
      const update = pathMoves[nextPathMove];
      nextPathMove += 1;
      if (update === undefined) throw new Error('out of moves');
      pathLocal.applyUpdate(update, SYSTEM_ORIGIN);
    },
    PATH_RUN,
  );

  bench(
    'applyUpdate of one remote vertex edit of one path, repair included',
    () => {
      const update = pathEdits[nextPathEdit];
      nextPathEdit += 1;
      if (update === undefined) throw new Error('out of edits');
      pathLocal.applyUpdate(update, SYSTEM_ORIGIN);
    },
    PATH_RUN,
  );

  bench('the repair check alone, over every path', () => {
    planReferenceRepair(pathView, new LastKnownBoard(pathLocal, pathInternals.lastKnown), pathIds);
  });
});
