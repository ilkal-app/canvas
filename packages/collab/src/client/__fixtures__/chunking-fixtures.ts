import * as Y from 'yjs';

import { createLargeBoardObjects, SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { MemoryDocumentCache, type MemoryCacheStorage } from '../../cache/memory-document-cache.js';

import type { FakeRelay, ReceivedKind } from './fake-relay.js';

// Shared by the outbound-chunk tests of the collab client.

/** The writer's Yjs client id. */
export const WRITER_ID = 4_246;

/** What a frame adds to its update: the board id, the message types and the length. */
export const FRAMING_BYTES = 64;

/** A memory cache whose log reads wait until the test lets them through. */
export class SlowLogCache extends MemoryDocumentCache {
  #release: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => {
    this.#release = resolve;
  });
  readonly #failure: Error | undefined;

  /**
   * Opens the cache.
   *
   * @param storage - The storage, shared with the caches of earlier page loads.
   * @param failure - Rejects every log read with it, once let through.
   */
  constructor(storage: MemoryCacheStorage, failure?: Error) {
    super(storage);
    this.#failure = failure;
  }

  /** Lets every waiting and later log read through. */
  release(): void {
    this.#release();
  }

  /** @inheritdoc */
  override async readUpdates(boardId: string): Promise<readonly Uint8Array[]> {
    await this.#gate;
    if (this.#failure !== undefined) throw this.#failure;
    return super.readUpdates(boardId);
  }
}

/** The client id of the writer's store after a reload: a new page load writes under a new one. */
export const RELOADED_WRITER_ID = 4_247;

/**
 * A store of the writer's client id.
 *
 * @param clientId - Its Yjs client id; the writer's by default.
 * @returns The store.
 */
export function writerStore(clientId = WRITER_ID): YjsDocumentStore {
  return new YjsDocumentStore({ clientId });
}

/**
 * Writes objects of the large-board mix in transactions, recording each transaction's end.
 *
 * @param store - The store.
 * @param count - How many objects.
 * @param perTransaction - Objects per transaction.
 * @param seed - The objects' seed.
 * @returns The writer's clock after each transaction.
 */
export function writeObjects(
  store: YjsDocumentStore,
  count: number,
  perTransaction: number,
  seed = 246,
): number[] {
  const ends: number[] = [];
  const objects = createLargeBoardObjects(count, seed);
  for (let start = 0; start < objects.length; start += perTransaction) {
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      for (const object of objects.slice(start, start + perTransaction)) {
        transaction.setObject(object);
      }
    });
    ends.push(Y.decodeStateVector(store.encodeStateVector()).get(WRITER_ID) ?? 0);
  }
  return ends;
}

/**
 * The sizes of the frames of a kind the relay received on a connection.
 *
 * @param relay - The fake relay.
 * @param kind - The message kind.
 * @param connection - The connection number.
 * @returns The sizes, in order.
 */
export function sizesOf(relay: FakeRelay, kind: ReceivedKind, connection: number): number[] {
  return relay.received
    .filter((entry) => entry.connection === connection && entry.kind === kind)
    .map((entry) => entry.size);
}

/**
 * Applies what the relay received, update by update, to an editor peer's store, counting the
 * peer's own writes: its reference repair writes when an update leaves a reference dangling.
 *
 * @param relay - The fake relay.
 * @returns How many writes the peer's repair made.
 */
export function peerRepairWrites(relay: FakeRelay): number {
  const peer = new YjsDocumentStore();
  let writes = 0;
  peer.subscribeUpdates(({ isLocal }) => {
    if (isLocal) writes += 1;
  });
  for (const update of relay.receivedUpdates) peer.applyUpdate(update, SYSTEM_ORIGIN);
  peer.destroy();
  return writes;
}

/**
 * Whether every step 2 the relay applied on a connection, but the last, ended at the end of one
 * of the writer's transactions (the last carries the delete set and anything made meanwhile).
 *
 * @param relay - The fake relay.
 * @param stepCount - How many step 2 messages the connection sent.
 * @param ends - The writer's clock after each transaction.
 * @returns The clocks that are not transaction ends; empty when every cut is between two.
 */
export function cutsInsideTransactions(
  relay: FakeRelay,
  stepCount: number,
  ends: readonly number[],
): number[] {
  const allowed = new Set([0, ...ends]);
  return relay.appliedStateVectors
    .slice(-stepCount, -1)
    .map((vector) => Y.decodeStateVector(vector).get(WRITER_ID) ?? 0)
    .filter((clock) => !allowed.has(clock));
}

/**
 * Whether two byte arrays hold the same bytes (`toEqual` on megabytes is slow).
 *
 * @param first - One array.
 * @param second - The other.
 * @returns `true` when equal.
 */
export function isSameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength && first.every((value, index) => value === second[index])
  );
}
