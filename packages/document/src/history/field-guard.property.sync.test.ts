import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  unreadableEntries,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';

import { ADA_ID, BOB_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import {
  createRandom,
  deleteMember,
  MEMBER_KEYS,
  memberValues,
  pick,
  presentKeys,
  valuesWrittenBy,
  writeMember,
  type Random,
} from './__fixtures__/member-property-fixtures.js';
import { createHistory, type UndoHistory } from './undo-manager.js';

// Seeded random sequences of adds, overwrites, deletes, undos and redos of map keys
// (vertices of the fixture path), to hold the field guard to the rules the fixed cases check
// one at a time. A failure names its seed and step; the sequence replays from the seed.

/** How many seeded sequences each property runs, and how many operations each has. */
const SEEDS = [...Array(100).keys()].map((index) => index + 1);
const STEPS = 60;

/** An edit of the map by one client. */
type Edit = 'add' | 'overwrite' | 'delete';

/** The edits, for picking one. */
const EDITS: readonly Edit[] = ['add', 'overwrite', 'delete'];

/**
 * Which ids an add uses: `'reused'` adds one of {@link MEMBER_KEYS} that is absent, so a key is
 * often written again after it was deleted; `'fresh'` adds a new id each time, as the pen does.
 */
type AddedIds = 'reused' | 'fresh';

/** One client of a sequence: its store, its history, its writes' origin and value tag. */
interface Client {
  readonly store: DocumentStore;
  readonly history: UndoHistory;
  readonly origin: TransactionOrigin;
  /** The `y` of every value this client writes, so a value tells who wrote it. */
  readonly tag: number;
}

/**
 * Makes one random edit, when the map allows it: an add needs an absent key, an overwrite or a
 * delete a present one.
 *
 * @param random - The random source.
 * @param client - Who edits.
 * @param ids - Which ids an add uses.
 * @param serial - A number no other write used, for the new value's x (and a fresh id).
 * @returns `true` when an edit was made.
 */
function makeEdit(random: Random, client: Client, ids: AddedIds, serial: number): boolean {
  const edit = pick(random, EDITS);
  const present = presentKeys(client.store);
  const absent =
    ids === 'fresh'
      ? [`p-${String(client.tag)}-${String(serial)}`]
      : MEMBER_KEYS.filter((key) => !present.includes(key));
  const candidates = edit === 'add' ? absent : present;
  if (candidates.length === 0) return false;
  const key = pick(random, candidates);
  if (edit === 'delete') deleteMember(client.store, client.origin, key);
  else writeMember(client.store, client.origin, key, serial, client.tag);
  return true;
}

/**
 * Checks a store's board is readable and keeps the board rules.
 *
 * @param store - The store.
 * @param where - The seed and step, for the failure message.
 */
function expectReadable(store: DocumentStore, where: string): void {
  expect(unreadableEntries(store), where).toEqual([]);
  expect(validateBoard(store.read()), where).toEqual([]);
}

/**
 * A store holding the fixture board, with Ada's history, as one client.
 *
 * @returns The client.
 */
function aloneClient(): Client {
  const store = createFixtureStore();
  return { store, history: createHistory(store, ADA_ID), origin: ADA, tag: 0 };
}

/**
 * Undoes up to a random number of steps and redoes as many as were undone, and checks that
 * returns the state they started from.
 *
 * @param random - The random source.
 * @param client - The client.
 * @param where - The seed, for the failure message.
 */
function expectUndosThenRedosRestore(random: Random, client: Client, where: string): void {
  const start = memberValues(client.store);
  const wanted = Math.ceil(random() * 10);
  let undone = 0;
  while (undone < wanted && client.history.undo()) undone += 1;
  for (let index = 0; index < undone; index += 1) {
    expect(client.history.redo(), `${where} redo ${String(index)}`).toBe(true);
  }
  expect(memberValues(client.store), where).toEqual(start);
}

describe('undo and redo of map keys by one client (seeded)', () => {
  // Every undo returns the state before the newest step not yet undone, and every redo the state
  // before that undo, exactly (a model of the two stacks), one step per call: with fresh ids, as
  // the pen makes them, and with reused ids, where a key is written again after it was deleted.
  // With reused ids Yjs used to refuse some restores once a new edit had dropped the redo stack
  // that recorded an undo of the user's own later write, and went on to the next step in the same
  // call (7 of these 100 seeds failed); the history now shows Yjs what the dropped redo
  // steps' undos deleted (`cleared-redo-steps.ts`) and applies one step per call.
  it.each(SEEDS.flatMap((seed) => (['fresh', 'reused'] as const).map((ids) => ({ seed, ids }))))(
    'matches a model of its stacks with $ids ids (seed $seed)',
    ({ seed, ids }) => {
      const random = createRandom(seed);
      const client = aloneClient();
      const past: string[][] = [];
      let future: string[][] = [];
      for (let step = 0; step < STEPS; step += 1) {
        const where = `seed ${String(seed)} step ${String(step)}`;
        const before = memberValues(client.store);
        const roll = random();
        if (roll < 0.25 && past.length > 0) {
          expect(client.history.undo(), where).toBe(true);
          expect(memberValues(client.store), where).toEqual(past.pop());
          future.push(before);
        } else if (roll < 0.4 && future.length > 0) {
          expect(client.history.redo(), where).toBe(true);
          expect(memberValues(client.store), where).toEqual(future.pop());
          past.push(before);
        } else if (makeEdit(random, client, ids, step)) {
          past.push(before);
          future = [];
        }
        expect(client.history.canUndo(), where).toBe(past.length > 0);
        expect(client.history.canRedo(), where).toBe(future.length > 0);
        expectReadable(client.store, where);
      }
      expectUndosThenRedosRestore(random, client, `seed ${String(seed)}`);
    },
  );
});

describe('undo and redo of map keys by two clients (seeded)', () => {
  // Each client edits, undoes and redoes at random, while the link between them goes down and
  // comes back. A client's undo or redo never deletes or replaces a value the other client
  // wrote (the other client's own item, not a copy an undo made of it: a write after the step,
  // or a concurrent one that won), and the clients converge on a valid board.
  it.each(SEEDS)('keeps the other client’s values and converges (seed %i)', (seed) => {
    const random = createRandom(seed);
    const [adaId, bobId] = seed % 2 === 0 ? [1, 2] : [2, 1];
    const [ada, bob] = createClientPair(adaId, bobId);
    const link = new Link(ada, bob);
    const adaClient: Client = {
      store: ada,
      history: createHistory(ada, ADA_ID),
      origin: ADA,
      tag: 0,
    };
    const bobClient: Client = {
      store: bob,
      history: createHistory(bob, BOB_ID),
      origin: BOB,
      tag: 1,
    };
    for (let step = 0; step < STEPS; step += 1) {
      const where = `seed ${String(seed)} step ${String(step)}`;
      const [client, other] = random() < 0.5 ? [adaClient, bobClient] : [bobClient, adaClient];
      const otherId = internalsOf(other.store).doc.clientID;
      const roll = random();
      if (roll < 0.35) {
        const theirs = valuesWrittenBy(client.store, otherId);
        if (roll < 0.2) client.history.undo();
        else client.history.redo();
        const after = valuesWrittenBy(client.store, otherId);
        for (const [key, item] of theirs) expect(after.get(key), `${where} ${key}`).toBe(item);
      } else if (roll < 0.45) {
        if (random() < 0.5) link.disconnect();
        else link.reconnect();
      } else {
        makeEdit(random, client, 'reused', step);
      }
      link.deliver();
      expectReadable(client.store, where);
    }
    link.reconnect();
    expectReadable(ada, `seed ${String(seed)} end`);
    expectReadable(bob, `seed ${String(seed)} end`);
    expect(new Map(ada.read().objects)).toEqual(new Map(bob.read().objects));
  });
});
