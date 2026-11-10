import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { validateBoard } from '@canvas/schema';

import type { TransactionOrigin } from '../origin/transaction-origin.js';
import { ADA, BOB, unreadableEntries } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';

import { ADA_ID, BOB_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import {
  createRandom,
  deleteMember,
  memberValues,
  pick,
  presentKeys,
  valueClockOf,
  writeMember,
  type Random,
} from './__fixtures__/member-property-fixtures.js';
import { createHistory, type UndoHistory } from './undo-manager.js';

// Fix round 1: seeded two-client properties of undo and redo over network members, with
// fresh ids as the pen makes them (each client adds members under its own prefix) and a link
// that drops and comes back. A failure names its seed and step; the sequence replays from it.

/** How many seeded sequences each property runs, and how many operations each has. */
const SEEDS = [...Array(100).keys()].map((index) => index + 1);
const STEPS = 60;

/** How many offline-then-online rounds the second property runs. */
const ROUNDS = 25;

/** One client of a sequence. */
interface Client {
  readonly store: DocumentStore;
  readonly history: UndoHistory;
  readonly origin: TransactionOrigin;
  /** The prefix of the members this client adds, and the `y` of every value it writes. */
  readonly tag: number;
  /** The Yjs client id. */
  readonly clientId: number;
}

/**
 * Two linked clients holding the fixture board, each with its own history; the merge order
 * alternates with the seed.
 *
 * @param seed - The sequence's seed.
 * @returns Ada, Bob and the link.
 */
function linkedClients(seed: number): { clients: [Client, Client]; link: Link } {
  const [adaId, bobId] = seed % 2 === 0 ? [1, 2] : [2, 1];
  const [ada, bob] = createClientPair(adaId, bobId);
  const client = (store: DocumentStore, principal: typeof ADA_ID, origin: TransactionOrigin) => ({
    store,
    history: createHistory(store, principal),
    origin,
    clientId: internalsOf(store).doc.clientID,
  });
  return {
    clients: [
      { ...client(ada, ADA_ID, ADA), tag: 0 },
      { ...client(bob, BOB_ID, BOB), tag: 1 },
    ],
    link: new Link(ada, bob),
  };
}

/**
 * The prefix of the members a client adds.
 *
 * @param client - The client.
 * @returns The prefix.
 */
function prefixOf(client: Client): string {
  return `p-${String(client.tag)}-`;
}

/** An edit a client made: the member, and whether it was deleted rather than written. */
interface MemberEdit {
  readonly key: string;
  readonly isDelete: boolean;
}

/**
 * Makes one random edit: adds a member under a fresh id of the client's own, or moves or
 * deletes a present member among `keys`.
 *
 * @param random - The random source.
 * @param client - Who edits.
 * @param keys - The members it may move or delete.
 * @param serial - A number no other write used, for the new value's x and a fresh id.
 * @returns The edit, or `undefined` when there was nothing to move or delete.
 */
function makeEdit(
  random: Random,
  client: Client,
  keys: readonly string[],
  serial: number,
): MemberEdit | undefined {
  const edit = pick(random, ['add', 'move', 'delete'] as const);
  if (edit !== 'add' && keys.length === 0) return undefined;
  const key = edit === 'add' ? `${prefixOf(client)}${String(serial)}` : pick(random, keys);
  if (edit === 'delete') deleteMember(client.store, client.origin, key);
  else writeMember(client.store, client.origin, key, serial, client.tag);
  return { key, isDelete: edit === 'delete' };
}

/**
 * Takes the link down or brings it back up at random.
 *
 * @param random - The random source.
 * @param link - The link.
 */
function toggleLink(random: Random, link: Link): void {
  if (random() < 0.5) link.disconnect();
  else link.reconnect();
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

describe('undo and redo of own members beside a collaborator (seeded)', () => {
  // Each client edits only members it added, and undoes and redoes them against an exact model
  // of its two stacks (as property 1 of `field-guard.property.sync.test.ts` does alone), while
  // the other edits its own members and the link drops: the other's edits change nothing.
  it.each(SEEDS)('matches each client’s stack model (seed %i)', (seed) => {
    const random = createRandom(seed);
    const { clients, link } = linkedClients(seed);
    const models = clients.map(() => ({ past: [] as string[][], future: [] as string[][] }));
    for (let step = 0; step < STEPS; step += 1) {
      const where = `seed ${String(seed)} step ${String(step)}`;
      const index = random() < 0.5 ? 0 : 1;
      const client = clients[index];
      const model = models[index] ?? { past: [], future: [] };
      const values = () => memberValues(client.store, prefixOf(client));
      const before = values();
      const roll = random();
      if (roll < 0.25 && model.past.length > 0) {
        expect(client.history.undo(), where).toBe(true);
        expect(values(), where).toEqual(model.past.pop());
        model.future.push(before);
      } else if (roll < 0.4 && model.future.length > 0) {
        expect(client.history.redo(), where).toBe(true);
        expect(values(), where).toEqual(model.future.pop());
        model.past.push(before);
      } else if (roll < 0.5) {
        toggleLink(random, link);
      } else {
        const own = presentKeys(client.store).filter((key) => key.startsWith(prefixOf(client)));
        if (makeEdit(random, client, own, step) !== undefined) {
          model.past.push(before);
          model.future = [];
        }
      }
      link.deliver();
      expectReadable(client.store, where);
    }
    link.reconnect();
    expect(new Map(clients[0].store.read().objects)).toEqual(
      new Map(clients[1].store.read().objects),
    );
  });
});

/**
 * An edit of a member by one client: the key and, for a write, the clock of the Yjs item
 * holding it (`null` for a delete).
 */
interface MemberWrite {
  /** The tag of the client that made it. */
  readonly tag: number;
  readonly key: string;
  readonly clock: number | null;
}

/**
 * One client of the second property: acts at random, and checks that its undos and redos never
 * empty a member the other client wrote after the step (see the test).
 */
class RacingClient {
  /** How much of the other client's history this client had seen when it made each step. */
  readonly #past: number[] = [];
  #future: number[] = [];

  /**
   * Starts a client's side of a sequence.
   *
   * @param client - The client.
   * @param other - The other client.
   * @param edits - Both clients' edits of members, shared by the two.
   */
  constructor(
    readonly client: Client,
    readonly other: Client,
    readonly edits: MemberWrite[],
  ) {}

  /**
   * Makes one random edit, undo, redo, undo then redo, or redo then undo. When the first of a
   * pair applies a step, the second must apply one too and bring back exactly the board the
   * client had before the pair.
   *
   * @param random - The random source.
   * @param serial - A number no other write used.
   * @param where - The seed and step, for failure messages.
   */
  act(random: Random, serial: number, where: string): void {
    const roll = random();
    if (roll < 0.15 || (roll >= 0.4 && roll < 0.45)) {
      this.#restore(roll < 0.15, where);
      return;
    }
    if (roll < 0.4) {
      const isUndoFirst = roll < 0.3;
      const board = new Map(this.client.store.read().objects);
      if (!this.#restore(isUndoFirst, where)) return;
      expect(this.#restore(!isUndoFirst, where), `${where} pair`).toBe(true);
      expect(new Map(this.client.store.read().objects), `${where} pair`).toEqual(board);
      return;
    }
    const known = this.#seenOfOther();
    const edit = makeEdit(random, this.client, presentKeys(this.client.store), serial);
    if (edit === undefined) return;
    this.#past.push(known);
    this.#future = [];
    const clock = edit.isDelete ? null : (valueClockOf(this.client.store, edit.key) ?? null);
    this.edits.push({ tag: this.client.tag, key: edit.key, clock });
  }

  /**
   * How much of the other client's history this client has seen: its Yjs state for it.
   *
   * @returns The state.
   */
  #seenOfOther(): number {
    const { doc } = internalsOf(this.client.store);
    return Y.getState(doc.store, this.other.clientId);
  }

  /**
   * Undoes or redoes one step, and checks every member it emptied was not written by the other
   * client after the step (unseen when the step was made, seen now). The step an undo pushes
   * onto the redo stack is made by the undo, so its user had in view what the client had seen
   * then; likewise for a redo.
   *
   * @param isUndo - Whether to undo rather than redo.
   * @param where - The seed and step, for failure messages.
   * @returns Whether a step was applied.
   */
  #restore(isUndo: boolean, where: string): boolean {
    const before = presentKeys(this.client.store);
    const [from, to] = isUndo ? [this.#past, this.#future] : [this.#future, this.#past];
    const history = this.client.history;
    const seenBefore = this.#seenOfOther();
    const isApplied = isUndo ? history.undo() : history.redo();
    const known = isApplied ? from.pop() : undefined;
    if (known === undefined) from.length = 0;
    else to.push(seenBefore);
    const after = new Set(presentKeys(this.client.store));
    const seen = this.#seenOfOther();
    for (const key of before.filter((candidate) => !after.has(candidate))) {
      // The other client's edits of the key; a delete after its write means it wants none.
      const edits = this.edits
        .filter(({ tag }) => tag === this.other.tag)
        .filter((write) => write.key === key);
      if (edits.at(-1)?.clock === null) continue;
      const writtenSince = edits.filter(
        ({ clock }) => clock !== null && clock >= (known ?? Infinity) && clock < seen,
      );
      expect(writtenSince, `${where} ${isUndo ? 'undo' : 'redo'} ${key}`).toEqual([]);
    }
    return isApplied;
  }
}

describe('undo and redo beside a collaborator writing the same members (seeded)', () => {
  // Both clients add members under their own ids and move or delete any member, in rounds: a
  // few operations each while the link is down, then one while it is up. An undo or redo never
  // leaves a member without a value when the other client wrote it concurrently with the step
  // being undone or redone, or since (a write the client has seen now but had not when the step
  // was made), and has not deleted it since. The step is the stack's: a user command, or the
  // inverse an undo or redo pushed, made with what the client had seen at that undo or redo
  // (fix round 2: judged against the command instead, the property contradicts the next one).
  // And an undo followed at once by a redo, or a redo by an undo, brings back exactly the board
  // the client had before. Each client keeps, per step, how much of the other's history it had
  // seen. When Yjs skips steps the model's step is a newer one, which had seen more, so the
  // check can then miss a case but not flag a wrong one.
  it.each(SEEDS)(
    'never empties a member the other wrote after the step, and pairs are exact (seed %i)',
    (seed) => {
      const random = createRandom(seed);
      const { clients, link } = linkedClients(seed);
      const edits: MemberWrite[] = [];
      const racers = [
        new RacingClient(clients[0], clients[1], edits),
        new RacingClient(clients[1], clients[0], edits),
      ];
      let serial = 0;
      for (let round = 0; round < ROUNDS; round += 1) {
        link.disconnect();
        for (const racer of racers) {
          const count = 1 + Math.floor(random() * 4);
          for (let index = 0; index < count; index += 1, serial += 1) {
            racer.act(random, serial, `seed ${String(seed)} round ${String(round)}`);
          }
        }
        link.reconnect();
        pick(random, racers).act(random, serial, `seed ${String(seed)} round ${String(round)} up`);
        serial += 1;
        link.deliver();
        for (const { store } of clients) expectReadable(store, `seed ${String(seed)}`);
      }
      expect(new Map(clients[0].store.read().objects)).toEqual(
        new Map(clients[1].store.read().objects),
      );
    },
  );
});
