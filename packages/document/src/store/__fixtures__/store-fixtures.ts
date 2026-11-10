import {
  importBoard,
  type Board,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
  type TextStyle,
} from '@canvas/schema';

import { createFixtureBoardJson } from '../../codec/__fixtures__/fixture-board-json.js';
import {
  isHiddenMemberIssue,
  isParentCycleIssue,
  type DecodeIssue,
} from '../../codec/decode-issue.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import type { DocumentStore } from '../document-store.js';
import { YjsDocumentStore } from '../yjs-document-store.js';

/** Ada, a person editing the board. */
export const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/** Bob, another person editing the board. */
export const BOB: TransactionOrigin = { kind: 'user', principalId: 'user:bob' as PrincipalId };

/** The origin remote updates are applied with in these tests. */
export const RELAY: TransactionOrigin = { kind: 'system', principalId: 'system' as PrincipalId };

/** The fixture board's body style. */
export const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  weight: 400,
  italic: false,
};

/**
 * The fixture board, imported through the schema's portable format.
 *
 * @returns A fresh board.
 */
export function fixtureBoard(): Board {
  return importBoard(createFixtureBoardJson());
}

/**
 * Reads a fixture id as an object id.
 *
 * @param value - The id text.
 * @returns The id, branded.
 */
export function id(value: string): ObjectId {
  return value as ObjectId;
}

/** The fixture board `fixtureObject` reads, imported once. */
let sharedBoard: Board | undefined;

/**
 * Finds an object of the fixture board by id and type. The board is imported once and each call
 * returns its own copy: importing it per call made a loop of a few thousand calls take seconds
 * on a loaded runner.
 *
 * @param objectId - The object id.
 * @param type - The object type expected.
 * @returns A fresh copy of the object.
 * @throws {Error} When the fixture has no such object of that type.
 */
export function fixtureObject<Type extends BoardObject['type']>(
  objectId: string,
  type: Type,
): Extract<BoardObject, { type: Type }> {
  sharedBoard ??= fixtureBoard();
  const object = sharedBoard.objects.get(id(objectId));
  if (object?.type !== type) throw new Error(`no fixture ${type} "${objectId}"`);
  return structuredClone(object) as Extract<BoardObject, { type: Type }>;
}

/**
 * Creates a store holding the fixture board, written by Ada in one transaction.
 *
 * @returns The store.
 */
export function createFixtureStore(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of fixtureBoard().objects.values()) transaction.setObject(object);
  });
  return store;
}

/**
 * Sends each store what the other lacks, by state-vector exchange, as the sync client does.
 *
 * @param first - One store.
 * @param second - The other store.
 */
export function exchange(first: YjsDocumentStore, second: YjsDocumentStore): void {
  const forSecond = first.encodeState(second.encodeStateVector());
  const forFirst = second.encodeState(first.encodeStateVector());
  second.applyUpdate(forSecond, RELAY);
  first.applyUpdate(forFirst, RELAY);
}

/**
 * Creates two stores holding the same fixture board, as two synced clients would.
 *
 * @returns The two stores.
 */
export function createSyncedPair(): [YjsDocumentStore, YjsDocumentStore] {
  const first = createFixtureStore();
  const second = new YjsDocumentStore();
  exchange(first, second);
  return [first, second];
}

/**
 * The entries of a store's board that cannot be read: its snapshot's issues without the network
 * members a read hid from a path it shows, which merges and undos may leave.
 *
 * @param store - The store.
 * @returns The issues of unreadable entries.
 */
export function unreadableEntries(store: DocumentStore): DecodeIssue[] {
  return store
    .read()
    .issues.filter((issue) => !isHiddenMemberIssue(issue) && !isParentCycleIssue(issue));
}
