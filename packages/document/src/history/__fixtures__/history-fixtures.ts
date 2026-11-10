import type { PrincipalId } from '@canvas/schema';

import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import { ADA, exchange, fixtureBoard, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore, DocumentUpdate } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';

/** Ada's principal id. */
export const ADA_ID = 'user:ada' as PrincipalId;

/** Bob's principal id. */
export const BOB_ID = 'user:bob' as PrincipalId;

/** Scout, an agent Ada operates: its changes are Ada's to undo. */
export const SCOUT_FOR_ADA: TransactionOrigin = {
  kind: 'agent',
  principalId: 'agent:scout' as PrincipalId,
  operatorId: ADA_ID,
};

/** Scout operated by Bob instead. */
export const SCOUT_FOR_BOB: TransactionOrigin = { ...SCOUT_FOR_ADA, operatorId: BOB_ID };

/** Ada's undo origin, as her history attributes its steps. */
export const ADA_UNDO: TransactionOrigin = { kind: 'undo', principalId: ADA_ID };

/**
 * Creates two synced stores holding the fixture board, with fixed Yjs client ids. When two
 * clients write one field concurrently, the write of the client with the higher id wins, so
 * tests of concurrent writes fix the ids to be deterministic.
 *
 * @param adaClientId - The Yjs client id of Ada's store, which writes the fixture board.
 * @param bobClientId - The Yjs client id of Bob's store.
 * @returns Ada's and Bob's stores.
 */
export function createClientPair(
  adaClientId: number,
  bobClientId: number,
): [YjsDocumentStore, YjsDocumentStore] {
  const [ada, bob] = [new YjsDocumentStore(), new YjsDocumentStore()];
  // Set before either document has written anything, as Yjs itself may reassign it.
  internalsOf(ada).doc.clientID = adaClientId;
  internalsOf(bob).doc.clientID = bobClientId;
  ada.transact(ADA, (transaction) => {
    for (const object of fixtureBoard().objects.values()) transaction.setObject(object);
  });
  exchange(ada, bob);
  return [ada, bob];
}

/**
 * A network link between two stores, as the sync client and relay would be: every local update
 * of one store is queued for the other and delivered by {@link Link.deliver}. While the link is
 * down, updates stay queued (buffered, as an offline client keeps them); reconnecting delivers
 * them. Deliveries are never made from inside a store's update listener, because a delivery can
 * make the receiving store emit an update of its own (a Yjs formatting cleanup).
 */
export class Link {
  readonly #queues = new Map<DocumentStore, DocumentUpdate[]>();
  readonly #peers: readonly [DocumentStore, DocumentStore];
  #isOnline = true;

  /**
   * Links two stores that already hold the same state.
   *
   * @param first - One store.
   * @param second - The other store.
   */
  constructor(first: DocumentStore, second: DocumentStore) {
    this.#peers = [first, second];
    for (const [from, to] of [
      [first, second],
      [second, first],
    ] as const) {
      const queue: DocumentUpdate[] = [];
      this.#queues.set(to, queue);
      from.subscribeUpdates((update) => {
        if (update.isLocal) queue.push(update);
      });
    }
  }

  /**
   * How many updates are waiting to be delivered, both ways.
   *
   * @returns The count.
   */
  get pendingCount(): number {
    return [...this.#queues.values()].reduce((count, queue) => count + queue.length, 0);
  }

  /** Takes the link down: updates are buffered until {@link Link.reconnect}. */
  disconnect(): void {
    this.#isOnline = false;
  }

  /** Brings the link back up and delivers everything buffered meanwhile. */
  reconnect(): void {
    this.#isOnline = true;
    this.deliver();
  }

  /** Delivers queued updates both ways until none are left, while the link is up. */
  deliver(): void {
    if (!this.#isOnline) return;
    while (this.pendingCount > 0) {
      for (const peer of this.#peers) {
        const queue = this.#queues.get(peer) ?? [];
        for (const { update } of queue.splice(0)) peer.applyUpdate(update, RELAY);
      }
    }
  }
}
