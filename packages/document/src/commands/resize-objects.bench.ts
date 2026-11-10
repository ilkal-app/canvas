import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId } from '@canvas/schema';

import { boxSourceOf, overlaySource } from '../bound/box-source.js';
import { worldBoundViolations } from '../bound/world-bound-check.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { NOW, testEnvironment } from './__fixtures__/command-fixtures.js';
import type { AnyCommand, CommandContext } from './command.js';
import { moveObjectsCommand } from './move-objects.js';
import { planCommand, recordWrites } from './preview-command.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { runCommand } from './run-command.js';

// A select-tool resize of a large multi-selection at release (review fix): the tool
// sends one entry per object, each with an `origin`, so validation must stay linear in the
// entries; the listed ids it checks each entry against are built once (rebuilding them per
// entry made 10,000 entries take about 22 s). The target is under 50 ms for the command's
// validation of 10,000 boxed objects (what was quadratic); the whole command is measured beside
// it, where the Yjs transaction writing 10,000 patches dominates (a store cost, the same for
// any command that writes as much). Each iteration of the whole command resizes to the other
// of two sizes, so every iteration writes.
//
// The board's bound is judged after validation, on what the command would write: its
// result is recorded (`recordWrites`) and every written object, and every descendant it carries,
// is compared before and after on the board (`worldBoundViolations`). That check is measured on
// its own for the resize, and for a move of a group carrying 10,000 descendants, which judges
// each carried box top-down in O(1) (two transforms, two boxes).

const COUNT = 10_000;

/** Base-62 digits, in fractional-index order. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A fractional-index key for the rectangle at an index: head `c` (three integer digits).
 *
 * @param index - The index, below 62³.
 * @returns The key.
 */
function keyOf(index: number): string {
  const digit = (value: number): string => DIGITS[value % 62] ?? '0';
  return `c${digit(Math.floor(index / 3844))}${digit(Math.floor(index / 62))}${digit(index)}`;
}

/**
 * 10,000 rectangles on a 50 world-unit grid.
 *
 * @param parentId - Their parent; the root by default.
 * @returns The objects.
 */
function board(parentId: ObjectId | null = null): BoardObject[] {
  return [...Array(COUNT).keys()].map((index) => ({
    id: `r${String(index)}` as ObjectId,
    parentId,
    x: (index % 100) * 50,
    y: Math.floor(index / 100) * 50,
    rotation: 0,
    z: keyOf(index),
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    type: 'shape',
    kind: 'rectangle',
    width: 40,
    height: 40,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  }));
}

const OBJECTS = board();
const STORE = new YjsDocumentStore();
STORE.transact(ADA, (transaction) => {
  for (const object of OBJECTS) transaction.setObject(object);
});
const ENVIRONMENT = testEnvironment();
let round = 0;

/** The input a select-tool release sends: every object, each with an origin. */
const RESIZES = {
  resizes: OBJECTS.map(({ id, x, y }) => ({
    id,
    to: { width: 44, height: 44 },
    origin: { x, y },
  })),
};

/** What `validate` reads. */
const CONTEXT: CommandContext = {
  board: STORE,
  origin: ADA,
  now: NOW,
  createId: ENVIRONMENT.createId,
};

describe('resizeObjects, 10,000 boxed objects', () => {
  bench('validation of one command resizing each with an origin (target < 50 ms)', () => {
    const validation = resizeObjectsCommand.validate(CONTEXT, RESIZES);
    if (!validation.isValid) throw new Error('the resize was refused');
  });

  bench('one command resizing each with an origin, as a select-tool release sends it', () => {
    round += 1;
    const size = round % 2 === 0 ? 40 : 44;
    const resizes = OBJECTS.map(({ id, x, y }) => ({
      id,
      to: { width: size, height: size },
      origin: { x, y },
    }));
    const outcome = runCommand(STORE, ADA, resizeObjectsCommand, { resizes }, ENVIRONMENT);
    if (outcome.status !== 'applied') throw new Error('the resize was refused');
  });
});

/**
 * The world-bound check of a command on a store: its result recorded and judged.
 *
 * @param store - The store.
 * @param command - The command.
 * @param input - Its input.
 * @returns The number of violations.
 * @throws {Error} When the command's validation refuses it.
 */
function boundCheck(store: YjsDocumentStore, command: AnyCommand, input: unknown): number {
  const planning = planCommand(store, ADA, command, input, ENVIRONMENT);
  if (planning.status === 'rejected') throw new Error('the command was refused');
  const written = recordWrites(command, planning.planned);
  const before = boxSourceOf(store);
  return worldBoundViolations(before, overlaySource(before, written), written.keys()).length;
}

describe('resizeObjects, 10,000 boxed objects: the board bound', () => {
  bench('the world-bound check of the resize: 10,000 written boxes, before and after', () => {
    if (boundCheck(STORE, resizeObjectsCommand, RESIZES) > 0) {
      throw new Error('the resize was refused');
    }
  });
});

/** A group at the root holding 10,000 rectangles, for a move that carries them all. */
const GROUPED_STORE = new YjsDocumentStore();
GROUPED_STORE.transact(ADA, (transaction) => {
  transaction.setObject({
    id: 'group' as ObjectId,
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    type: 'group',
  });
  for (const object of board('group' as ObjectId)) transaction.setObject(object);
});
const GROUP_MOVE = { moves: [{ id: 'group', by: { x: 1, y: 1 } }] };
let step = 0;

describe('moveObjects of a group carrying 10,000 descendants', () => {
  bench('the world-bound check: one chain walk, then 10,000 carried boxes top-down', () => {
    if (boundCheck(GROUPED_STORE, moveObjectsCommand, GROUP_MOVE) > 0) {
      throw new Error('the move was refused');
    }
  });

  bench('the whole command, as a drag of the group sends it', () => {
    step += 1;
    const by = step % 2 === 0 ? 1 : -1;
    const moves = [{ id: 'group', by: { x: by, y: by } }];
    const outcome = runCommand(GROUPED_STORE, ADA, moveObjectsCommand, { moves }, ENVIRONMENT);
    if (outcome.status !== 'applied') throw new Error('the move was refused');
  });
});
