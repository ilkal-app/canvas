// Fix round 2, the reviewer's scenario: on a board two other people built (frames with
// children, connectors and pinned comments, some across authors), a third deletes every frame
// and undoes it. The delete runs as transactions of at most 1,000 objects (three parts here,
// with children, connectors and comments in another part than their frame or target) and is
// one undo step; its undo re-creates the objects one part per transaction, referents first,
// each under the chunk size. An editor peer applying every message the relay receives, one by
// one, writes no repair and ends byte-equal to the sender; a field the peer changed after the
// delete keeps the peer's value through the grouped undo ('s field guard). An undo, redo,
// undo round trip ends on the board the first undo left.
//
// 2,200 objects rather than 5,000 (three parts instead of five, the same boundaries and
// authors at under half the work), with a turn of the event loop between phases, so Vitest's
// worker can report its progress while the test runs. The board has no frame > group > member
// nesting: the group level of the ordering rule is covered by `creation-guard.groups.test.ts`
// in `packages/document`.
import { afterEach, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createHistory,
  createLargeBoardObjects,
  deleteObjectsCommand,
  MAX_OBJECTS_PER_TRANSACTION,
  runCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type UndoHistory,
  type TransactionOrigin,
} from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import { OUTBOUND_CHUNK_BYTES } from '../chunking/split-update.js';

import { FRAMING_BYTES, sizesOf } from './__fixtures__/chunking-fixtures.js';
import { ClientHarness } from './__fixtures__/client-harness.js';
import { encodeUpdateMessage } from './relay-protocol.js';

const CAROL: TransactionOrigin = { kind: 'user', principalId: 'user:carol' as PrincipalId };
/** Objects each author writes: 11 frames of 100 (the frame and 99 children). */
const AUTHOR_OBJECTS = 1_100;
/** Objects the delete removes: both authors' frames with their children. */
const DELETED_OBJECTS = 2 * AUTHOR_OBJECTS;
/** Transactions the delete runs as: 1,000, 1,000 and 200 deletions. */
const DELETE_PARTS = Math.ceil(DELETED_OBJECTS / MAX_OBJECTS_PER_TRANSACTION);
/** Where the peer moves a detached cross-author connector's end after the delete. */
const PEER_POINT = { kind: 'point', x: 4_321, y: 1_234 } as const;

let harness: ClientHarness;

afterEach(() => {
  harness.destroy();
});

/**
 * Lets the event loop turn, so Vitest's worker can answer its runner between phases.
 *
 * @returns A promise that resolves on the next turn.
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * One author's part of the board: {@link AUTHOR_OBJECTS} objects of the large-board mix (frames
 * of 99 children, connectors and comments attached inside each frame), written in transactions
 * of 500.
 *
 * @param clientId - The author's Yjs client id.
 * @param seed - The objects' seed.
 * @returns The author's store.
 */
function authorStore(clientId: number, seed: number): YjsDocumentStore {
  const store = new YjsDocumentStore({ clientId });
  const objects = createLargeBoardObjects(AUTHOR_OBJECTS, seed);
  for (let start = 0; start < objects.length; start += 500) {
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of objects.slice(start, start + 500)) transaction.setObject(object);
    });
  }
  return store;
}

/**
 * Has one author attach connectors and pin comments to the other author's objects, at the root.
 *
 * @param from - The author writing them.
 * @param to - The other author's store, already merged into `from`.
 * @returns The ids of the connectors written.
 * @throws {Error} When the fixture board has no connector or comment to copy.
 */
function crossReferences(from: YjsDocumentStore, to: YjsDocumentStore): ObjectId[] {
  const own = [...from.read().objects.values()];
  const connector = own.find((object) => object.type === 'connector');
  const comment = own.find((object) => object.type === 'comment');
  const targets = [...to.read().objects.values()].filter(
    (object) => object.type === 'shape' || object.type === 'sticky',
  );
  if (connector?.type !== 'connector' || comment?.type !== 'comment') {
    throw new Error('the fixture has connectors and comments');
  }
  const ids: ObjectId[] = [];
  from.transact(SYSTEM_ORIGIN, (transaction) => {
    for (let index = 0; index + 1 < Math.min(targets.length, 120); index += 2) {
      const [first, second] = [targets[index], targets[index + 1]];
      if (first === undefined || second === undefined) continue;
      const id = `${connector.id}x${String(index)}` as ObjectId;
      ids.push(id);
      transaction.setObject({
        ...connector,
        id,
        parentId: null,
        from: { kind: 'object', objectId: first.id, anchor: null },
        to: { kind: 'object', objectId: second.id, anchor: null },
      });
      transaction.setObject({
        ...comment,
        id: `${comment.id}x${String(index)}` as ObjectId,
        parentId: null,
        anchor: { kind: 'object', objectId: first.id, offset: { x: 5, y: 5 } },
      });
    }
  });
  return ids;
}

/**
 * Applies updates to a peer, counting the peer's own writes (its reference repair) meanwhile.
 *
 * @param peer - The editor peer.
 * @param updates - The updates, in order.
 * @returns How many writes the peer's repair made.
 */
function applyCounting(peer: YjsDocumentStore, updates: readonly Uint8Array[]): number {
  let writes = 0;
  const stop = peer.subscribeUpdates(({ isLocal }) => {
    if (isLocal) writes += 1;
  });
  for (const update of updates) peer.applyUpdate(update, SYSTEM_ORIGIN);
  stop();
  return writes;
}

/**
 * A board's objects as text: their JSON, ordered by id, a value per line (so a failure shows the
 * lines that differ). Two boards are byte for byte the same when their texts are equal; the
 * tests compare texts with `toBe` (`toEqual` walks two byte arrays of a 2,000-object
 * board element by element, seconds per comparison).
 *
 * @param store - The store.
 * @returns The text.
 */
function boardText(store: YjsDocumentStore): string {
  const objects = [...store.read().objects.values()].sort((first, second) =>
    first.id < second.id ? -1 : 1,
  );
  return JSON.stringify(objects, null, 1);
}

/**
 * The objects an object refers to, each with the kind of reference: its parent (`child`), a
 * connector's attached ends (`connector`), a comment's anchor (`comment`).
 *
 * @param object - The object.
 * @returns The references.
 */
function referencesOf(object: BoardObject): { kind: string; id: ObjectId }[] {
  const references = object.parentId === null ? [] : [{ kind: 'child', id: object.parentId }];
  if (object.type === 'connector') {
    for (const end of [object.from, object.to]) {
      if (end.kind === 'object') references.push({ kind: 'connector', id: end.objectId });
    }
  }
  if (object.type === 'comment' && object.anchor.kind === 'object') {
    references.push({ kind: 'comment', id: object.anchor.objectId });
  }
  return references;
}

/**
 * The kinds of reference that cross from one part of the delete into another.
 *
 * @param objects - The board before the delete, by id.
 * @param deletedIds - The ids deleted, in the order the parts delete them.
 * @returns The kinds, sorted.
 */
function crossingKinds(
  objects: ReadonlyMap<ObjectId, BoardObject>,
  deletedIds: readonly ObjectId[],
): string[] {
  const partOf = new Map(
    deletedIds.map((id, index) => [id, Math.floor(index / MAX_OBJECTS_PER_TRANSACTION)]),
  );
  const kinds = new Set<string>();
  for (const id of deletedIds) {
    const object = objects.get(id);
    if (object === undefined) continue;
    for (const reference of referencesOf(object)) {
      const part = partOf.get(reference.id);
      if (part !== undefined && part !== partOf.get(id)) kinds.add(reference.kind);
    }
  }
  return [...kinds].sort();
}

/** The board, the deleting editor and the peer, once the delete is done. */
interface DeletedBoard {
  /** Carol's store, connected through the harness. */
  readonly carol: YjsDocumentStore;
  /** The editor peer, which applies every message alone. */
  readonly peer: YjsDocumentStore;
  /** Carol's history. */
  readonly history: UndoHistory;
  /** The relay's updates of the delete. */
  readonly deletes: readonly Uint8Array[];
  /** The kinds of reference that cross a part boundary of the delete, sorted. */
  readonly crossing: readonly string[];
  /** The peer's repair writes while it applied the delete. */
  readonly deleteRepairs: number;
  /** The cross-author connector whose end the peer moved after the delete. */
  readonly moved: ObjectId;
}

/**
 * Builds the two authors' board on the relay and an editor peer, connects Carol, has her delete
 * every frame, lets the peer apply each update of the delete alone, then has the peer move a
 * detached cross-author connector's end and the relay send that to Carol.
 *
 * @returns The stores, Carol's history and what the delete sent.
 * @throws {Error} When the delete is refused or the moved connector did not survive it.
 */
async function deleteEveryFrame(): Promise<DeletedBoard> {
  harness = new ClientHarness();
  const ada = authorStore(1_001, 61);
  const bob = authorStore(1_002, 62);
  ada.applyUpdate(bob.encodeState(), SYSTEM_ORIGIN);
  const crossConnectors = crossReferences(ada, bob);
  Y.applyUpdate(harness.relay.doc, ada.encodeState());
  const peer = new YjsDocumentStore({ clientId: 1_004 });
  peer.applyUpdate(ada.encodeState(), SYSTEM_ORIGIN);
  const carol = new YjsDocumentStore({ clientId: 1_003 });
  await harness.connect({ store: carol });
  await nextTurn();
  const history = createHistory(carol, CAROL.principalId);
  const before = carol.read().objects;
  const ids = [...before.values()].filter(({ type }) => type === 'frame').map(({ id }) => id);
  const environment = { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(63) };

  const mark = harness.relay.receivedUpdates.length;
  const deleted = runCommand(carol, CAROL, deleteObjectsCommand, { ids }, environment);
  if (deleted.status !== 'applied') throw new Error('the delete was refused');
  expect(deleted.result.deletedIds).toHaveLength(DELETED_OBJECTS);
  harness.relay.run();
  const deletes = harness.relay.receivedUpdates.slice(mark);
  const deleteRepairs = applyCounting(peer, deletes);
  await nextTurn();

  // The peer moves a detached connector's end after the delete; the undo must keep it.
  const moved = crossConnectors[0] ?? ('' as ObjectId);
  const peerState = peer.encodeStateVector();
  const edited = peer.get(moved);
  if (edited?.type !== 'connector') throw new Error('the cross connector survives the delete');
  peer.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject({ ...edited, from: PEER_POINT });
  });
  const peerEdit = peer.encodeSyncState(peerState);
  Y.applyUpdate(harness.relay.doc, peerEdit);
  harness.relay.sendToAll((name) => encodeUpdateMessage(name, peerEdit));
  harness.relay.run();
  await nextTurn();
  const crossing = crossingKinds(before, deleted.result.deletedIds);
  return { carol, peer, history, deletes, crossing, deleteRepairs, moved };
}

/**
 * Undoes Carol's delete, as one step, and runs the relay.
 *
 * @param board - The board after the delete.
 * @returns The relay's updates of the undo, and the sizes of the update messages Carol sent.
 */
async function undoTheDelete(
  board: DeletedBoard,
): Promise<{ undoes: Uint8Array[]; sentSizes: number[] }> {
  const mark = harness.relay.receivedUpdates.length;
  const sizesBefore = sizesOf(harness.relay, 'update', 1).length;
  expect(board.history.undo()).toBe(true);
  expect(board.history.canUndo()).toBe(false);
  harness.relay.run();
  await nextTurn();
  return {
    undoes: harness.relay.receivedUpdates.slice(mark),
    sentSizes: sizesOf(harness.relay, 'update', 1).slice(sizesBefore),
  };
}

it(
  'deletes 2,200 objects of two authors in three parts and undoes it in parts no peer repairs',
  { timeout: 60_000 },
  async () => {
    const board = await deleteEveryFrame();
    const { carol, peer } = board;
    // Children, connectors and comments sit in another part than their frame or target.
    expect(board.crossing).toEqual(['child', 'comment', 'connector']);
    expect(board.deletes.length).toBe(DELETE_PARTS);
    expect(board.deleteRepairs).toBe(0);

    const { undoes, sentSizes } = await undoTheDelete(board);
    expect(undoes.length).toBeGreaterThanOrEqual(DELETE_PARTS);
    for (const size of sentSizes) {
      expect(size).toBeLessThanOrEqual(OUTBOUND_CHUNK_BYTES + FRAMING_BYTES);
    }
    expect(applyCounting(peer, undoes)).toBe(0);
    expect(carol.read().objects.size).toBe(peer.read().objects.size);
    // The same CRDT state (clocks and deletions; Yjs may cut the same structs differently, so the
    // encodings can differ) and, byte for byte, the same board.
    expect(peer.encodeStateVector()).toEqual(carol.encodeStateVector());
    const deletions = (store: YjsDocumentStore) => Y.decodeUpdate(store.encodeState()).ds;
    expect(Y.equalDeleteSets(deletions(peer), deletions(carol))).toBe(true);
    expect(boardText(peer)).toBe(boardText(carol));
    expect(carol.get(board.moved)).toMatchObject({ from: PEER_POINT });
  },
);

it(
  'ends an undo, redo, undo round trip of that delete on the board the first undo left',
  { timeout: 60_000 },
  async () => {
    // The board after the second undo is the board after the first, and the peer, applying
    // every message alone, repairs nothing and ends with it too.
    const board = await deleteEveryFrame();
    const { carol, peer, history } = board;
    const { undoes } = await undoTheDelete(board);
    expect(applyCounting(peer, undoes)).toBe(0);
    const afterFirstUndo = boardText(carol);
    expect(boardText(peer)).toBe(afterFirstUndo);

    const mark = harness.relay.receivedUpdates.length;
    expect(history.redo()).toBe(true);
    harness.relay.run();
    expect(carol.read().objects.size).toBeLessThan(peer.read().objects.size);
    await nextTurn();
    expect(history.undo()).toBe(true);
    harness.relay.run();
    await nextTurn();
    expect(applyCounting(peer, harness.relay.receivedUpdates.slice(mark))).toBe(0);
    expect(boardText(carol)).toBe(afterFirstUndo);
    expect(boardText(peer)).toBe(afterFirstUndo);
  },
);
