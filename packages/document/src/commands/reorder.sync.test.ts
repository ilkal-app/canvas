import { describe, expect, it } from 'vitest';

import { isValidKey, type ObjectId } from '@canvas/schema';

import { ADA, BOB, exchange, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createSeededRandom, type SeededRandom } from '../z-order/__fixtures__/seeded-random.js';
import { createSiblingStore, FRAME_ID, objectId } from '../z-order/__fixtures__/sibling-board.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import {
  bringForwardCommand,
  bringToFrontCommand,
  sendBackwardCommand,
  sendToBackCommand,
  type ReorderCommand,
} from './reorder.js';
import { runCommand } from './run-command.js';

// Sync tests for z-order: clients reorder the same siblings concurrently
// and must converge to one total order. The fuzz below is this task's own and covers reorders
// alone; every registered command runs in randomised concurrent sequences on N clients under
// partitions, delays and reordering in the sync fuzz harness (tooling/sync-fuzz). Client
// ids are fixed, so a seed replays every random choice and every merge exactly.

/** The commands the fuzz picks from. */
const REORDER_COMMANDS: readonly ReorderCommand[] = [
  bringToFrontCommand,
  sendToBackCommand,
  bringForwardCommand,
  sendBackwardCommand,
];

/** The parents whose children the fuzz reorders. */
const PARENTS: readonly (ObjectId | null)[] = [FRAME_ID, null];

/** One simulated client: its store and the local updates it has not sent yet. */
interface Client {
  readonly store: YjsDocumentStore;
  readonly outbox: Uint8Array[];
  readonly inbox: Uint8Array[];
}

/**
 * Creates a client holding a copy of the base board, collecting its own updates to send.
 *
 * @param state - The base board's state.
 * @param clientId - Its Yjs client id, fixed so that a seed replays the merges exactly.
 * @returns The client.
 */
function createClient(state: Uint8Array, clientId: number): Client {
  const store = new YjsDocumentStore({ clientId });
  store.applyUpdate(state, RELAY);
  const client: Client = { store, outbox: [], inbox: [] };
  store.subscribeUpdates((update) => {
    if (update.isLocal) client.outbox.push(update.update);
  });
  return client;
}

/**
 * Runs one random reorder on a client's own view of the board, if it can see any siblings.
 *
 * @param client - The client.
 * @param random - The seeded choices.
 * @param seed - The seed, for the failure message.
 */
function reorderAtRandom(client: Client, random: SeededRandom, seed: number): void {
  // Updates arrive out of order here, and Yjs applies an update's deletions before insertions
  // that wait for a missing update, so an object can be unreadable for a while (its old `z`
  // deleted, the new one pending). Its siblings are then missing from this client's view.
  const siblings = sortedSiblings(client.store, random.pick(PARENTS));
  if (siblings.length === 0) return;
  const ids = random.shuffle(siblings).slice(0, 1 + random.below(4));
  const command = random.pick(REORDER_COMMANDS);
  const outcome = runCommand(client.store, ADA, command, { ids }, testEnvironment(seed));
  expect(outcome.status, `seed ${String(seed)}: ${command.name} ${ids.join(',')}`).toBe('applied');
}

/**
 * Delivers some of each client's pending updates, in a random order; the rest stay in flight.
 *
 * @param clients - The clients.
 * @param random - The seeded choices.
 * @param isFinal - Deliver everything.
 */
function deliver(clients: readonly Client[], random: SeededRandom, isFinal: boolean): void {
  for (const sender of clients) {
    for (const receiver of clients) {
      if (receiver !== sender) receiver.inbox.push(...sender.outbox);
    }
    sender.outbox.length = 0;
  }
  for (const receiver of clients) {
    const shuffled = random.shuffle(receiver.inbox);
    const count = isFinal ? shuffled.length : random.below(shuffled.length + 1);
    receiver.inbox.splice(0, receiver.inbox.length, ...shuffled.slice(count));
    for (const update of shuffled.slice(0, count)) receiver.store.applyUpdate(update, RELAY);
  }
}

/**
 * Asserts every client holds the same keys, and that each parent's keys are valid and distinct.
 *
 * @param clients - The clients.
 * @param seed - The seed, for the failure message.
 */
function expectConverged(clients: readonly Client[], seed: number): void {
  const keysOf = (client: Client) =>
    new Map([...client.store.read().objects].map(([id, object]) => [id, object.z]));
  for (const client of clients)
    expect(client.store.read().issues, `seed ${String(seed)}`).toEqual([]);
  const [first, ...others] = clients.map(keysOf);
  for (const keys of others) expect(keys, `seed ${String(seed)}`).toEqual(first);
  for (const parentId of PARENTS) {
    const orders = clients.map((client) => sortedSiblings(client.store, parentId));
    for (const order of orders) expect(order, `seed ${String(seed)}`).toEqual(orders[0]);
    const keys = (orders[0] ?? []).map((id) => first?.get(id) ?? '');
    expect(new Set(keys).size, `seed ${String(seed)}: duplicate keys`).toBe(keys.length);
    for (const key of keys) expect(isValidKey(key), `seed ${String(seed)}: ${key}`).toBe(true);
  }
}

describe('concurrent reorders', () => {
  it('converge when two clients bring different objects to front', () => {
    const ada = createSiblingStore();
    const bob = new YjsDocumentStore();
    exchange(ada, bob);
    runCommand(ada, ADA, bringToFrontCommand, { ids: ['s1'] }, testEnvironment());
    runCommand(bob, BOB, bringToFrontCommand, { ids: ['s2'] }, testEnvironment());
    exchange(ada, bob);
    const order = sortedSiblings(ada, FRAME_ID);
    expect(sortedSiblings(bob, FRAME_ID)).toEqual(order);
    expect(order.slice(0, 4)).toEqual(['s0', 's3', 's4', 's5']);
    expect(new Set(order.slice(4))).toEqual(new Set(['s1', 's2']));
    expect(ada.get(objectId('s1'))?.z).not.toBe(ada.get(objectId('s2'))?.z);
  });

  it('converge when one client moves an object forward and another sends a sibling back', () => {
    const ada = createSiblingStore();
    const bob = new YjsDocumentStore();
    exchange(ada, bob);
    runCommand(ada, ADA, bringForwardCommand, { ids: ['s2'] }, testEnvironment());
    runCommand(bob, BOB, sendToBackCommand, { ids: ['s4'] }, testEnvironment());
    exchange(ada, bob);
    expect(sortedSiblings(ada, FRAME_ID)).toEqual(['s4', 's0', 's1', 's3', 's2', 's5']);
    expect(sortedSiblings(bob, FRAME_ID)).toEqual(sortedSiblings(ada, FRAME_ID));
  });

  it('keep one of two concurrent moves of the same object, on every client', () => {
    const ada = createSiblingStore();
    const bob = new YjsDocumentStore();
    exchange(ada, bob);
    runCommand(ada, ADA, bringToFrontCommand, { ids: ['s0'] }, testEnvironment());
    runCommand(bob, BOB, sendToBackCommand, { ids: ['s0'] }, testEnvironment());
    exchange(ada, bob);
    const order = sortedSiblings(ada, FRAME_ID);
    expect(sortedSiblings(bob, FRAME_ID)).toEqual(order);
    expect([order[0], order.at(-1)]).toContain('s0');
  });
});

/**
 * Runs one fuzz scenario: 2 to 5 clients, 8 rounds of 1 to 3 random reorders each, updates
 * delivered in random orders with some held back, then everything delivered.
 *
 * @param seed - The seed of every random choice; client ids are fixed, so it replays exactly.
 * @returns The converged keys, by object id.
 */
function runFuzz(seed: number): ReadonlyMap<ObjectId, string> {
  const random = createSeededRandom(seed);
  const state = createSiblingStore(10).encodeState();
  const clients = Array.from({ length: 2 + random.below(4) }, (...[, index]) =>
    createClient(state, 100 + index),
  );
  for (let round = 0; round < 8; round += 1) {
    for (const client of clients) {
      const count = 1 + random.below(3);
      for (let move = 0; move < count; move += 1) reorderAtRandom(client, random, seed);
    }
    deliver(clients, random, false);
  }
  deliver(clients, random, true);
  expectConverged(clients, seed);
  const [first] = clients;
  return new Map([...(first?.store.read().objects ?? [])].map(([id, object]) => [id, object.z]));
}

describe('reorder fuzz', () => {
  const seeds = [...Array(40).keys()].map((index) => 4_700 + index);

  it.each(seeds)('N clients reordering one board at random converge (seed %i)', (seed) => {
    runFuzz(seed);
  });

  it('replays a seed exactly, merge winners included', () => {
    for (const seed of seeds.slice(0, 10)) expect(runFuzz(seed)).toEqual(runFuzz(seed));
  });
});
