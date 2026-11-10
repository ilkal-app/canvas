import { describe, expect, it } from 'vitest';

import { validateBoard, type BoardObject } from '@canvas/schema';

import { connectCommand } from '../commands/connect.js';
import { createObjectCommand } from '../commands/create-object.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { groupCommand } from '../commands/group.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { runCommand, type CommandEnvironment } from '../commands/run-command.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import type { TransactionOrigin } from '../origin/transaction-origin.js';
import {
  ADA,
  BOB,
  BODY,
  fixtureBoard,
  id,
  unreadableEntries,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';

import { newShape, NEW_FRAME } from './__fixtures__/creation-fixtures.js';
import { ADA_ID, BOB_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import { createRandom, pick, type Random } from './__fixtures__/member-property-fixtures.js';
import { ModelledClient, ProductItems, stateOf } from './__fixtures__/undo-oracle.js';
import { createHistory } from './undo-manager.js';

// Fix round 1 (I3): seeded random interleavings of two clients creating, pasting,
// grouping, restyling, moving (into frames too), typing labels, attaching connectors, deleting
// (frames too, for repair races), undoing and redoing, over a link that drops and comes back,
// in both client-id orders, with ids reused after deletes. The invariant, checked around every
// undo and redo: no value another person wrote since the step, and that was on the clicking
// client's board, is gone after the click (`undo-oracle.ts`). At the end both boards converge
// and are valid. SYNC_FUZZ_SEED and SYNC_FUZZ_ITERATIONS set the first seed and the count, as
// for the sync fuzz harness; a failure names its seed and step.

/**
 * The first seed of each property and how many sequences each runs per client-id order:
 * SYNC_FUZZ_SEED and SYNC_FUZZ_ITERATIONS override them. The default ranges hold sequences that
 * the code before fix round 1 failed: C1 in the broad mix (seed 20261117, both client-id
 * orders: a creation undone after a delete and its undo re-created another person's move as
 * the undoing client's own) and I1a in the focused mix (seed 100227, Ada's client id 1: after a
 * repair race the peer's repair won, and the peer's later move into the undoing client's new
 * frame was excused).
 */
const ITERATIONS = Number(process.env.SYNC_FUZZ_ITERATIONS ?? 60);
const seedsFrom = (first: number): number[] => {
  const start = Number(process.env.SYNC_FUZZ_SEED ?? first);
  return [...Array(ITERATIONS).keys()].map((index) => start + index);
};
const BROAD_SEEDS = seedsFrom(20_261_100);
const FOCUSED_SEEDS = seedsFrom(100_200);
const STEPS = 80;

/** Object ids reused after deletes: a shape and a frame each client may create again. */
const REUSED_SHAPES = ['n0', 'n1'];
const REUSED_FRAMES = ['f0', 'f1'];

/** One client in a sequence. */
interface Actor {
  readonly client: ModelledClient;
  readonly origin: TransactionOrigin;
  readonly environment: CommandEnvironment;
}

/**
 * The objects of a board of some types.
 *
 * @param store - The store.
 * @param types - The types.
 * @returns The objects, by id order.
 */
function objectsOf(store: DocumentStore, types: readonly string[]): BoardObject[] {
  return [...store.read().objects.values()]
    .filter((object) => types.includes(object.type))
    .sort((first, second) => first.id.localeCompare(second.id));
}

/** The fixture board's objects; objects the sequence creates are picked more often. */
const FIXTURE_IDS: ReadonlySet<string> = new Set(fixtureBoard().objects.keys());

/**
 * Picks an object to act on, three times in four among those the sequence created (when there
 * are any), so the two clients often act on the same new objects.
 *
 * @param random - The random source.
 * @param objects - The candidates, not empty.
 * @returns One of them.
 */
function pickTarget(random: Random, objects: readonly BoardObject[]): BoardObject {
  const created = objects.filter((object) => !FIXTURE_IDS.has(object.id));
  return created.length > 0 && random() < 0.75 ? pick(random, created) : pick(random, objects);
}

/**
 * Maps a random number onto the commands of the focused mix: shapes and frames created, shapes
 * moved into frames, and deletes; so repair races, frames and moves into them meet often.
 *
 * @param value - A random number in [0, 1).
 * @returns A roll for {@link randomCommand}.
 */
function focusedRoll(value: number): number {
  if (value < 0.25) return 0.07; // create a shape
  if (value < 0.45) return 0.18; // create a frame
  if (value < 0.9) return 0.5; // move, mostly into a frame
  return 0.9; // delete
}

/**
 * The inputs of one random command for an actor, or `undefined` when the board has nothing to
 * apply it to.
 *
 * @param random - The random source.
 * @param store - The actor's store.
 * @param serial - A number no other command used.
 * @param isFocused - Whether to draw from the focused mix ({@link focusedRoll}).
 * @returns A command and its input.
 */
function randomCommand(random: Random, store: DocumentStore, serial: number, isFocused: boolean) {
  const shapes = objectsOf(store, ['shape']);
  const frames = objectsOf(store, ['frame']);
  const movable = objectsOf(store, ['shape', 'frame', 'group', 'sticky', 'image']);
  const colour: [number, number, number, number] = [random(), random(), random(), 1];
  const roll = isFocused ? focusedRoll(random()) : random();
  if (roll < 0.14) {
    const free = REUSED_SHAPES.filter((key) => store.get(id(key)) === undefined);
    const parent = random() < 0.4 && frames.length > 0 ? pickTarget(random, frames).id : null;
    const objectId = free.length > 0 && random() < 0.7 ? pick(random, free) : `s${String(serial)}`;
    return { command: createObjectCommand, input: { object: newShape(objectId, parent) } };
  }
  if (roll < 0.22) {
    const free = REUSED_FRAMES.filter((key) => store.get(id(key)) === undefined);
    if (free.length === 0) return undefined;
    const object = { ...NEW_FRAME, id: pick(random, free), x: 3_000 + serial };
    return { command: createObjectCommand, input: { object } };
  }
  if (roll < 0.28) {
    const objects = [
      { type: 'group' as const, id: 'g', x: 4_000, y: serial, rotation: 0.25 },
      newShape('a', 'g'),
      { ...newShape('b', 'g'), x: 200 },
    ];
    return { command: createObjectsCommand, input: { objects } };
  }
  const roots = shapes.filter((shape) => shape.parentId === null);
  if (roll < 0.32 && roots.length >= 2) {
    const ids = [pickTarget(random, roots).id, pickTarget(random, roots).id];
    return ids[0] === ids[1] ? undefined : { command: groupCommand, input: { ids } };
  }
  if (roll < 0.46 && shapes.length > 0) {
    const changes = [{ id: pickTarget(random, shapes).id, style: { fill: colour } }];
    return { command: setStyleCommand, input: { changes } };
  }
  if (roll < 0.62 && movable.length > 0) {
    const moved = pickTarget(random, movable);
    // Only leaves go into frames: two clients moving containers into each other at once make a
    // parent cycle, which no repair breaks (the sync fuzz avoids it too, `board-view.ts`).
    const isLeaf = moved.type !== 'frame' && moved.type !== 'group';
    const into =
      isLeaf && random() < (isFocused ? 0.9 : 0.5) && frames.length > 0
        ? { parentId: pickTarget(random, frames).id }
        : {};
    const moves = [{ id: moved.id, by: { x: 1 + serial, y: 0 }, ...into }];
    return { command: moveObjectsCommand, input: { moves } };
  }
  if (roll < 0.7 && shapes.length > 0) {
    const text = `t${String(serial)}`;
    const input = {
      id: pickTarget(random, shapes).id,
      text,
      runs: [{ length: text.length, style: BODY }],
    };
    return { command: setTextRunsCommand, input };
  }
  if (roll < 0.78 && movable.length > 0) {
    const input = {
      from: { objectId: pickTarget(random, movable).id },
      to: { point: { x: 0, y: 0 } },
    };
    return { command: connectCommand, input };
  }
  // Half the deletes take a frame, whose children then race the repair on every client.
  const doomed = frames.length > 0 && random() < 0.5 ? frames : movable;
  if (doomed.length === 0) return undefined;
  return { command: deleteObjectsCommand, input: { ids: [pickTarget(random, doomed).id] } };
}

/**
 * Runs one random command as an actor, and notes the step it records.
 *
 * @param random - The random source.
 * @param actor - The actor.
 * @param serial - A number no other command used.
 * @param isFocused - Whether to draw from the focused mix.
 * @returns What it did, for the trace.
 */
function runRandomCommand(
  random: Random,
  actor: Actor,
  serial: number,
  isFocused: boolean,
): string {
  const chosen = randomCommand(random, actor.client.store, serial, isFocused);
  if (chosen === undefined) return 'nothing';
  return runAs(actor, chosen.command, chosen.input);
}

/**
 * Runs a command as an actor and notes the step it records.
 *
 * @param actor - The actor.
 * @param command - The command.
 * @param input - Its input.
 * @returns What it did, for the trace.
 */
function runAs(actor: Actor, command: Parameters<typeof runCommand>[2], input: unknown): string {
  const { store } = actor.client;
  const past = stateOf(store);
  const outcome = runCommand(store, actor.origin, command, input, actor.environment);
  const what = `${command.name} ${JSON.stringify(input)}`;
  if (outcome.status === 'rejected') return `${what} refused`;
  const { created, updated, deleted } = outcome.changes;
  if (created.length + updated.length + deleted.length > 0) actor.client.noteStep(past, what);
  return `${what} -> ${JSON.stringify(outcome.changes)}`;
}

/**
 * A repair race: while the link is down, one actor moves a shape into a frame and the other
 * deletes that frame; once they reconnect, both clients repair the shape (fix round 1,
 * the product's own writes).
 *
 * @param random - The random source.
 * @param mover - Who moves the shape.
 * @param deleter - Who deletes the frame.
 * @param link - The link.
 * @returns What happened, for the trace.
 */
function repairRace(random: Random, mover: Actor, deleter: Actor, link: Link): string {
  const shapes = objectsOf(mover.client.store, ['shape']);
  const frames = objectsOf(mover.client.store, ['frame']);
  if (shapes.length === 0 || frames.length === 0) return 'race: nothing to race';
  const shape = pickTarget(random, shapes);
  const frame = pickTarget(random, frames);
  link.disconnect();
  const moves = [{ id: shape.id, by: { x: 1, y: 1 }, parentId: frame.id }];
  const moved = runAs(mover, moveObjectsCommand, { moves });
  const deleted = runAs(deleter, deleteObjectsCommand, {
    ids: [frame.id],
  });
  link.reconnect();
  return `race: ${moved}; other ${deleted}`;
}

/**
 * Runs one seeded sequence and returns what went wrong.
 *
 * @param seed - The seed.
 * @param adaClientId - Ada's Yjs client id; Bob's is the other of 1 and 2.
 * @param isFocused - Whether commands come from the focused mix (frames, moves into them,
 *   deletes) rather than every kind.
 * @returns Each value lost, with the step it was lost at, and the whole sequence.
 */
function runSequence(
  seed: number,
  adaClientId: number,
  isFocused = false,
): { lost: string[]; sequence: string } {
  const random = createRandom(seed);
  const [ada, bob] = createClientPair(adaClientId, 3 - adaClientId);
  const link = new Link(ada, bob);
  const products = new ProductItems();
  products.watch(ada);
  products.watch(bob);
  let serial = 0;
  const actorOf = (store: typeof ada, origin: TransactionOrigin, principal: typeof ADA_ID) => ({
    client: new ModelledClient(store, createHistory(store, principal)),
    origin,
    environment: {
      clock: () => 1_780_000_000_000 + serial,
      createId: () => id(`x${String((serial += 1))}`),
    },
  });
  const actors = [actorOf(ada, ADA, ADA_ID), actorOf(bob, BOB, BOB_ID)];
  const lost: string[] = [];
  const trace: string[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    const index = random() < 0.5 ? 0 : 1;
    const actor = actors[index] as Actor;
    const roll = random();
    serial += 1;
    let what: string;
    if (roll < 0.15) what = (link.deliver(), 'deliver');
    else if (roll < 0.19) what = (link.disconnect(), 'disconnect');
    else if (roll < 0.25) what = (link.reconnect(), 'reconnect');
    else if (roll < 0.3) what = repairRace(random, actor, actors[1 - index] as Actor, link);
    else if (roll < 0.53) {
      const direction = roll < 0.46 ? 'undo' : 'redo';
      let gone: string[];
      try {
        gone = actor.client.click(direction, products);
      } catch (error) {
        lost.push(`step ${String(step)} ${direction} threw: ${String(error)}`);
        trace.push(`${String(step)} ${index === 0 ? 'ada' : 'bob'} ${direction} THREW`);
        break;
      }
      lost.push(...gone.map((value) => `step ${String(step)} ${direction}: ${value}`));
      what = `${direction}${gone.length > 0 ? ` LOST ${gone.join(', ')}` : ''}`;
    } else what = runRandomCommand(random, actor, serial, isFocused);
    trace.push(`${String(step)} ${index === 0 ? 'ada' : 'bob'} ${what}`);
  }
  link.reconnect();
  const sequence = trace.join('\n');
  expect(unreadableEntries(ada), sequence).toEqual([]);
  expect(new Map(ada.read().objects), sequence).toEqual(new Map(bob.read().objects));
  expect(validateBoard(ada.read()), sequence).toEqual([]);
  return { lost, sequence };
}

describe('undo and redo never lose another person’s work (seeded)', () => {
  it.each(BROAD_SEEDS.flatMap((seed) => [1, 2].map((adaClientId) => ({ seed, adaClientId }))))(
    'seed $seed, Ada client id $adaClientId',
    ({ seed, adaClientId }) => {
      const { lost, sequence } = runSequence(seed, adaClientId);
      expect(lost, sequence).toEqual([]);
    },
  );
});

describe('undo and redo never lose another person’s work, frames and repair races (seeded)', () => {
  // The focused mix: frames, shapes moved into them and deletes, beside repair races, so a
  // peer's repair winning a key and a person's later write of it (review I1a) come up often.
  it.each(FOCUSED_SEEDS.flatMap((seed) => [1, 2].map((adaClientId) => ({ seed, adaClientId }))))(
    'seed $seed, Ada client id $adaClientId',
    ({ seed, adaClientId }) => {
      const { lost, sequence } = runSequence(seed, adaClientId, true);
      expect(lost, sequence).toEqual([]);
    },
  );
});

describe('the sequences the 10,000-sequence run found (fix round 2)', () => {
  // Named so they run whatever the seed ranges above: fix round 1's code lost another person's
  // value in each (the label typed into and restored by a delete's undo, 1185; a `z` value, 1599;
  // a reused frame's placement, 2088).
  it.each([
    { seed: 1185, adaClientId: 1, isFocused: false },
    { seed: 1185, adaClientId: 2, isFocused: false },
    { seed: 1599, adaClientId: 1, isFocused: true },
    { seed: 1599, adaClientId: 2, isFocused: true },
    { seed: 2088, adaClientId: 1, isFocused: true },
  ])('seed $seed, Ada client id $adaClientId', ({ seed, adaClientId, isFocused }) => {
    const { lost, sequence } = runSequence(seed, adaClientId, isFocused);
    expect(lost, sequence).toEqual([]);
  });
});

describe('the sequences whose undo threw inside Yjs', () => {
  // Named so they run whatever the seed ranges above: Yjs's `redoItem` followed a value to its
  // collected copy and threw part-way through the step (`collected-copies.ts`,
  // `undo-manager.deleted-objects.sync.test.ts`). The step is now used up unapplied.
  it.each([
    { seed: 20_261_451, adaClientId: 2, isFocused: false },
    { seed: 102_566, adaClientId: 2, isFocused: false },
    { seed: 100_064, adaClientId: 2, isFocused: true },
    { seed: 101_696, adaClientId: 1, isFocused: true },
  ])('seed $seed, Ada client id $adaClientId', ({ seed, adaClientId, isFocused }) => {
    const { lost, sequence } = runSequence(seed, adaClientId, isFocused);
    expect(lost, sequence).toEqual([]);
  });
});
