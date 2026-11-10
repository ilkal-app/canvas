// Shared by the parent-cycle tests: clients on the nested-frames board with fixed Yjs
// client ids, a move into a frame, a hostile client's raw placement write, a mesh of N linked
// stores, and the world placement of an object computed independently of the repair.
import * as Y from 'yjs';

import {
  objectToBoardTransform,
  type Board,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import {
  applyCommand,
  NOW,
  testEnvironment,
} from '../../commands/__fixtures__/command-fixtures.js';
import { nestedFrameObjects } from '../../commands/__fixtures__/nested-frames.js';
import { moveObjectsCommand } from '../../commands/move-objects.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import { ADA, exchange, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore, DocumentUpdate } from '../../store/document-store.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../../store/yjs-document-store.js';

/**
 * Stores holding the nested-frames board (`frame-outer` holding `frame-inner`, `rect-outer` and
 * `group-g`; `frame-side` holding `rect-side`), synced, one per client id, the first writing it.
 *
 * @param clientIds - The Yjs client ids, one per store.
 * @param extra - Objects to add to the board.
 * @returns The stores, in the order of the ids.
 */
export function createFrameClients(
  clientIds: readonly number[],
  extra: readonly BoardObject[] = [],
): YjsDocumentStore[] {
  const stores = clientIds.map((clientId) => new YjsDocumentStore({ clientId }));
  const [first, ...rest] = stores;
  first?.transact(ADA, (transaction) => {
    for (const object of [...nestedFrameObjects(), ...extra]) transaction.setObject(object);
  });
  for (const store of rest) if (first !== undefined) exchange(first, store);
  return stores;
}

/**
 * A third root frame beside `frame-outer` and `frame-side`, for three-member cycles.
 *
 * @returns The frame, 300 × 300 at (1500, 0), holding nothing.
 * @throws {Error} When the nested-frames board has no `frame-side` (a broken fixture).
 */
export function thirdFrame(): BoardObject {
  const side = nestedFrameObjects().find(({ id }) => id === 'frame-side');
  if (side?.type !== 'frame') throw new Error('the nested-frames board has no frame-side');
  return { ...side, id: 'frame-third' as ObjectId, x: 1500, z: 'a4', name: 'frame-third' };
}

/**
 * Moves an object into a frame (or onto the root) by a delta, as a drag and drop does.
 *
 * @param store - The acting client.
 * @param objectId - The object.
 * @param parentId - The frame, or `null`.
 * @param by - The delta, board coordinates.
 * @param origin - Who moves it.
 * @param time - The command's clock.
 */
export function moveInto(
  store: DocumentStore,
  objectId: string,
  parentId: string | null,
  by: Point,
  origin: TransactionOrigin = ADA,
  time = NOW,
): void {
  applyCommand(store, moveObjectsCommand, { moves: [{ id: objectId, by, parentId }] }, origin, {
    ...testEnvironment(31),
    clock: () => time,
  });
}

/** The Yjs client id of the next hostile write: each writes as a new client. */
let hostileClientId = 900;

/**
 * A hostile client's raw write, which no command validates: it rewrites stored groups of
 * objects in a copy of the store's document and returns the update, as a peer skipping the
 * command layer would send it.
 *
 * @param store - A store holding the board.
 * @param writes - Per object id, the groups to overwrite (`placement`, `size`, ...), merged
 *   over the stored values, or `null` to delete the object.
 * @returns The update.
 */
export function hostileUpdate(
  store: YjsDocumentStore,
  writes: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>> | null>
  >,
): Uint8Array {
  const doc = new Y.Doc();
  hostileClientId += 1;
  doc.clientID = hostileClientId;
  Y.applyUpdate(doc, store.encodeState());
  const before = Y.encodeStateVector(doc);
  const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
  doc.transact(() => {
    for (const [objectId, groups] of Object.entries(writes)) {
      if (groups === null) {
        objects.delete(objectId);
        continue;
      }
      const map = objects.get(objectId);
      if (map === undefined) throw new Error(`no stored object "${objectId}"`);
      for (const [key, patch] of Object.entries(groups)) {
        map.set(key, { ...(map.get(key) as Record<string, unknown>), ...patch });
      }
    }
  });
  return Y.encodeStateAsUpdate(doc, before);
}

/**
 * The world placement of an object, rounded for comparison: cos, sin, x and y.
 *
 * @param board - A board holding it and its ancestors, with no parent cycle.
 * @param objectId - The object.
 * @returns The rounded transform.
 * @throws {Error} When the board has no such object.
 */
export function worldOf(board: Board, objectId: string): number[] {
  const object = board.objects.get(objectId as ObjectId);
  if (object === undefined) throw new Error(`no object "${objectId}"`);
  const { cos, sin, x, y } = objectToBoardTransform(board, object);
  return [cos, sin, x, y].map((value) => Math.round(value * 1e6) / 1e6);
}

/**
 * Links N stores as a relay would: every local update of one is queued for all the others and
 * delivered by {@link Mesh.deliver}, one store's queue at a time.
 */
export class Mesh {
  readonly #queues = new Map<DocumentStore, DocumentUpdate[]>();
  readonly #stores: readonly DocumentStore[];
  /** How many local updates each store has sent, by index. */
  readonly sent: number[];

  /**
   * Links the stores, which already hold the same state.
   *
   * @param stores - The stores.
   */
  constructor(stores: readonly DocumentStore[]) {
    this.#stores = stores;
    this.sent = stores.map(() => 0);
    for (const store of stores) this.#queues.set(store, []);
    stores.forEach((from, index) => {
      from.subscribeUpdates((update) => {
        if (!update.isLocal) return;
        this.sent[index] = (this.sent[index] ?? 0) + 1;
        for (const to of stores) if (to !== from) this.#queues.get(to)?.push(update);
      });
    });
  }

  /** Delivers queued updates until none are left. */
  deliver(): void {
    const pending = () => [...this.#queues.values()].some((queue) => queue.length > 0);
    while (pending()) {
      for (const store of this.#stores) {
        for (const { update } of this.#queues.get(store)?.splice(0) ?? []) {
          store.applyUpdate(update, RELAY);
        }
      }
    }
  }
}
