// As a property: on boards where a peer left random values the relay's door refuses
// (written raw, at the start and again later, on both clients, as a board stored before the
// door, or a path no door sees, delivers them), Ada runs random honest commands, single and
// grouped into one step of several parts (`runAsOneStep`), Bob writes too, and Ada
// undoes and redoes at random. No update Ada's history sends is refused by the door's own
// judgement (`judgeFieldWrites`, against a hub in sync with her store), and's PROTECT
// property holds around every click: no value Bob wrote since the step, and that was on Ada's
// board, is gone after it (`undo-oracle.ts`). At the end both boards converge, readable and
// valid. Seeded; SYNC_FUZZ_SEED and SYNC_FUZZ_ITERATIONS set the first seed and the count.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { judgedAtDoor } from '../commands/__fixtures__/door-judgement.js';
import {
  commandOn,
  poisonUpdate,
  type RawPoison,
} from '../commands/__fixtures__/poisoned-commands.js';
import type { AnyCommand } from '../commands/command.js';
import { COMMANDS } from '../commands/registry.js';
import { runCommand } from '../commands/run-command.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import { ADA, BOB, RELAY, unreadableEntries } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createSeededRandom, type SeededRandom } from '../z-order/__fixtures__/seeded-random.js';

import { ADA_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import { ModelledClient, ProductItems, stateOf } from './__fixtures__/undo-oracle.js';
import { depthsOf } from './history-depths.js';
import { runAsOneStep } from './undo-groups.js';
import { createHistory } from './undo-manager.js';

const ITERATIONS = Number(process.env.SYNC_FUZZ_ITERATIONS ?? 40);
const FIRST_SEED = Number(process.env.SYNC_FUZZ_SEED ?? 275_000);
const SEEDS = [...Array(ITERATIONS).keys()].map((index) => FIRST_SEED + index);
const STEPS = 40;

/** How many clicks, over every sequence run, left a restore out for the door. */
let omissions = 0;

/** Values the door judges under own keys: a line's ends. */
const EXTRA_POISONS: Readonly<Record<string, readonly RawPoison[]>> = {
  line: [
    ['points.0', { x: Number.POSITIVE_INFINITY }],
    ['points.1', { y: Number.NaN }],
  ],
};

/** One sequence's clients. */
interface Sequence {
  readonly random: SeededRandom;
  readonly ada: YjsDocumentStore;
  readonly bob: YjsDocumentStore;
  readonly link: Link;
  readonly client: ModelledClient;
  readonly products: ProductItems;
  readonly poisoned: Set<string>;
  readonly trace: string[];
}

/**
 * Leaves random values the door refuses on both boards, as the relay's stored board or another
 * path no door judges delivers them to every client: a person's write (stamped), so PROTECT
 * keeps it as it keeps any other person's work.
 *
 * @param sequence - The sequence.
 */
function poisonBoth(sequence: Sequence): void {
  const { ada, bob, random, poisoned } = sequence;
  const { update, ids } = poisonUpdate(ada, random, EXTRA_POISONS, true);
  ada.applyUpdate(update, RELAY);
  bob.applyUpdate(update, RELAY);
  for (const id of ids) poisoned.add(id);
  sequence.trace.push(`poison ${ids.join(',')}`);
}

/**
 * Picks an object, mostly a poisoned one.
 *
 * @param sequence - The sequence.
 * @param store - The board to pick on.
 * @returns The object, or `undefined` on an empty board.
 */
function target(sequence: Sequence, store: YjsDocumentStore): BoardObject | undefined {
  const objects = [...store.read().objects.values()];
  if (objects.length === 0) return undefined;
  const onPoisoned = objects.filter(({ id }) => sequence.poisoned.has(id));
  const { random } = sequence;
  return onPoisoned.length > 0 && random.next() < 0.8
    ? random.pick(onPoisoned)
    : random.pick(objects);
}

/**
 * Runs one random honest command on a store.
 *
 * @param sequence - The sequence.
 * @param store - The store.
 * @param origin - Who runs it.
 * @param seed - The id generator's seed.
 * @returns What it did, for the trace.
 */
function runRandom(
  sequence: Sequence,
  store: YjsDocumentStore,
  origin: TransactionOrigin,
  seed: number,
): string {
  const object = target(sequence, store);
  if (object === undefined) return 'nothing';
  const [name, input] = commandOn(sequence.random, object);
  const outcome = runCommand(
    store,
    origin,
    COMMANDS[name] as AnyCommand,
    input,
    testEnvironment(seed),
  );
  return `${name} ${object.id} ${outcome.status}`;
}

/**
 * Ada's step: one command, or two or three in parts of one step; every update judged.
 *
 * @param sequence - The sequence.
 * @param seed - The id generator's seed.
 * @returns What it did.
 */
function adaStep(sequence: Sequence, seed: number): string {
  const { ada, client, random } = sequence;
  const count = random.next() < 0.3 ? 2 + random.below(2) : 1;
  const past = stateOf(ada);
  const before = depthsOf(client.history).undo;
  const done: string[] = [];
  const { findings } = judgedAtDoor(ada, () => {
    const write = (): void => {
      for (let index = 0; index < count; index += 1) {
        done.push(runRandom(sequence, ada, ADA, seed * 10 + index));
      }
    };
    if (count === 1) write();
    else runAsOneStep(ada, write);
  });
  const what = `ada ${done.join('; ')}`;
  expect(findings, what).toEqual([]);
  const parts = depthsOf(client.history).undo - before;
  if (parts > 0) client.noteStep(past, what, parts);
  return what;
}

/**
 * Ada's undo or redo, judged at the door and by the PROTECT oracle.
 *
 * @param sequence - The sequence.
 * @param direction - Which.
 * @returns What it did, and the values another person lost.
 */
function adaClick(sequence: Sequence, direction: 'undo' | 'redo'): string {
  const { ada, client, products } = sequence;
  let lost: string[] = [];
  const { findings } = judgedAtDoor(ada, () => {
    lost = client.click(direction, products);
  });
  const omission = client.history.lastOmission();
  if (omission !== undefined) omissions += 1;
  const what = `${direction} ${omission ?? ''}`;
  expect({ what, findings, lost }).toEqual({ what, findings: [], lost: [] });
  return what;
}

/**
 * Runs one seeded sequence.
 *
 * @param seed - The seed.
 * @returns The trace of what happened.
 */
function runSequence(seed: number): string {
  const [ada, bob] = createClientPair(1 + (seed % 2), 2 - (seed % 2));
  const products = new ProductItems();
  products.watch(ada);
  products.watch(bob);
  const sequence: Sequence = {
    random: createSeededRandom(seed),
    ada,
    bob,
    link: new Link(ada, bob),
    client: new ModelledClient(ada, createHistory(ada, ADA_ID)),
    products,
    poisoned: new Set(),
    trace: [],
  };
  poisonBoth(sequence);
  for (let step = 0; step < STEPS; step += 1) {
    const roll = sequence.random.next();
    const serial = seed * 100 + step;
    if (roll < 0.1) sequence.link.deliver();
    else if (roll < 0.15) poisonBoth(sequence);
    else if (roll < 0.25) sequence.trace.push(`bob ${runRandom(sequence, bob, BOB, serial)}`);
    else if (roll < 0.6) sequence.trace.push(adaStep(sequence, serial));
    else sequence.trace.push(adaClick(sequence, roll < 0.85 ? 'undo' : 'redo'));
  }
  sequence.link.deliver();
  const trace = sequence.trace.join('\n');
  expect(unreadableEntries(ada), trace).toEqual([]);
  expect(new Map(ada.read().objects), trace).toEqual(new Map(bob.read().objects));
  return trace;
}

describe('undo and redo on boards holding values the door refuses (seeded)', () => {
  it.each(SEEDS)('seed %i: no update is refused at the door, and PROTECT holds', (seed) => {
    const trace = runSequence(seed);
    expect(trace.length).toBeGreaterThan(0);
  });

  it('left a restore out in some sequences: the property reaches the guard', () => {
    expect(omissions).toBeGreaterThan(0);
  });
});
