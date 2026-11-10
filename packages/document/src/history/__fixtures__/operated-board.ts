import { expect } from 'vitest';
import type { z } from 'zod';

import { applyCommand } from '../../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../../commands/move-objects.js';
import type { newObjectSchema } from '../../commands/new-object-schema.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import {
  ADA,
  BODY,
  fixtureBoard,
  fixtureObject,
  RELAY,
} from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore, DocumentUpdate } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import type { OperatedWriters } from '../operated-writes.js';
import { createHistory } from '../undo-manager.js';

import { ADA_ID } from './history-fixtures.js';

// Ada's browser, Scout's process (an agent she operates, on the hosted MCP server) and
// Bob's browser, each a store, linked through a relay, for the operated-writes sync tests.

/** Ada's browser's Yjs client id. */
export const ADA_CLIENT = 100;
/** The Yjs client id Scout, her agent, writes under. */
export const SCOUT_CLIENT = 200;
/** Bob's browser's Yjs client id. */
export const BOB_CLIENT = 300;
/** The fixture board's photo. */
export const PHOTO = fixtureObject('image-photo', 'image');

/** A sticky note Scout creates. */
export const STICKY: z.input<typeof newObjectSchema> = {
  type: 'sticky',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  text: 'Hi',
  runs: [{ length: 2, style: BODY }],
  align: 'center',
  autoWidth: false,
  verticalAlign: 'middle',
  color: [1, 1, 0, 1],
};

/**
 * The caller's word on Scout's client id: recorded, and owned unless told otherwise.
 *
 * @param owns - Whether Scout's id is owned (the relay vouched for it), or not known yet.
 * @returns The writers.
 */
export function scoutWriters(owns: () => boolean | undefined = () => true): OperatedWriters {
  return {
    records: (clientId) => clientId === SCOUT_CLIENT,
    owns: (clientId) => (clientId === SCOUT_CLIENT ? owns() : false),
  };
}

/** A relay between several stores: each local update reaches the others on `deliver()`. */
export class Relay {
  readonly #queues = new Map<DocumentStore, DocumentUpdate[]>();

  /**
   * Links stores that already hold the same state.
   *
   * @param stores - The stores.
   */
  constructor(stores: readonly DocumentStore[]) {
    for (const store of stores) this.#queues.set(store, []);
    for (const from of stores) {
      from.subscribeUpdates((update) => {
        if (!update.isLocal) return;
        for (const to of stores) if (to !== from) this.#queues.get(to)?.push(update);
      });
    }
  }

  /** Delivers every queued update, one remote transaction each, until none are left. */
  deliver(): void {
    for (let isAny = true; isAny;) {
      isAny = false;
      for (const [store, queue] of this.#queues) {
        for (const { update } of queue.splice(0)) {
          isAny = true;
          store.applyUpdate(update, RELAY);
        }
      }
    }
  }
}

/**
 * A store with a fixed Yjs client id, synced to the fixture board.
 *
 * @param clientId - Its client id.
 * @param board - A store holding the board, or none to write it.
 * @returns The store.
 */
export function storeOf(clientId: number, board?: YjsDocumentStore): YjsDocumentStore {
  const store = new YjsDocumentStore();
  internalsOf(store).doc.clientID = clientId;
  if (board === undefined) {
    store.transact(ADA, (transaction) => {
      for (const object of fixtureBoard().objects.values()) transaction.setObject(object);
    });
  } else {
    store.applyUpdate(board.encodeState(), RELAY);
  }
  return store;
}

/**
 * Ada's, Scout's and Bob's stores, linked, with Ada's history, which records Scout's writes.
 *
 * @param options - Ada's history's capture window, and whether it is told of Scout.
 * @param options.captureTimeout - The capture window, ms.
 * @param options.isTold - Whether the history gets `operatedWriters` (default true).
 * @param options.owns - Whether Scout's id is owned (default always).
 * @returns The stores, the relay and Ada's history.
 */
export function createBoard(
  options: {
    readonly captureTimeout?: number;
    readonly isTold?: boolean;
    readonly owns?: () => boolean | undefined;
  } = {},
) {
  const ada = storeOf(ADA_CLIENT);
  const scout = storeOf(SCOUT_CLIENT, ada);
  const bob = storeOf(BOB_CLIENT, ada);
  const relay = new Relay([ada, scout, bob]);
  const history = createHistory(ada, ADA_ID, {
    ...(options.captureTimeout === undefined ? {} : { captureTimeout: options.captureTimeout }),
    ...(options.isTold === false ? {} : { operatedWriters: scoutWriters(options.owns) }),
  });
  return { ada, scout, bob, relay, history };
}

/**
 * Moves the photo by a delta in x.
 *
 * @param store - The store.
 * @param dx - The delta.
 * @param origin - Who moves it.
 */
export function movePhoto(store: DocumentStore, dx: number, origin: TransactionOrigin): void {
  applyCommand(
    store,
    moveObjectsCommand,
    { moves: [{ id: 'image-photo', by: { x: dx, y: 0 } }] },
    origin,
  );
}

/**
 * Expects every store to hold the same board.
 *
 * @param stores - The stores.
 */
export function expectConverged(...stores: readonly DocumentStore[]): void {
  const [first, ...rest] = stores.map((store) => [...store.read().objects.entries()]);
  for (const other of rest) expect(other).toEqual(first);
}
