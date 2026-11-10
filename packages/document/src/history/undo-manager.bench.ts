import { bench, describe } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { moveObjectsCommand } from '../commands/move-objects.js';
import { runCommand } from '../commands/run-command.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { formatMebibytes, measureRetainedHeap } from '../store/__fixtures__/heap-measure.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { ADA_ID } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

// Undo on a 10k-object board: 1k steps, each one `moveObjects`
// command on a different object, then undo and redo latency per step with the stacks 1k deep.
// The memory the stacks keep alive (the deleted field values Yjs must not collect while a step
// can restore them) is the heap of a board that ran the 1k commands with a history, minus one
// that ran them without; it is in the describe title, because `pnpm bench` reports only times,
// in square brackets, which the regression gate leaves out of a benchmark's key.
// Run with `NODE_OPTIONS=--expose-gc` for figures without garbage.

const OBJECT_COUNT = 10_000;
const STEP_COUNT = 1_000;
const objects = createLargeBoardObjects(OBJECT_COUNT, 48);
const targets: readonly ObjectId[] = objects.slice(0, STEP_COUNT).map(({ id }) => id);
const environment = testEnvironment();

/**
 * Builds the 10k-object board.
 *
 * @returns A store holding it.
 */
function createBoard(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  store.read();
  return store;
}

/**
 * Moves one object as Ada, one command.
 *
 * @param store - The store.
 * @param target - The object.
 * @throws {Error} When the command is rejected.
 */
function move(store: YjsDocumentStore, target: ObjectId): void {
  const input = { moves: [{ id: target, by: { x: 1, y: 1 } }] };
  const outcome = runCommand(store, ADA, moveObjectsCommand, input, environment);
  if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome.errors));
}

/**
 * Runs the 1k commands, one per target.
 *
 * @param store - The store.
 */
function runSteps(store: YjsDocumentStore): void {
  for (const target of targets) move(store, target);
}

const withoutHistory = measureRetainedHeap(() => {
  const store = createBoard();
  runSteps(store);
  return store;
});
const withHistory = measureRetainedHeap(() => {
  const store = createBoard();
  const history = createHistory(store, ADA_ID);
  runSteps(store);
  return { store, history };
});
const stackBytes =
  withoutHistory.bytes === null || withHistory.bytes === null
    ? null
    : withHistory.bytes - withoutHistory.bytes;
const { store, history } = withHistory.value;
// Fewer iterations than steps: the runner may call the function once more to warm up, and redo
// can only reapply what undo reverted.
const UNDOS = { time: 0, iterations: STEP_COUNT - 10, warmupTime: 0, warmupIterations: 0 };
const REDOS = { ...UNDOS, iterations: STEP_COUNT - 20 };

describe(
  `${String(STEP_COUNT)} undo steps on a ${String(OBJECT_COUNT)}-object board ` +
    `[stacks keep ${formatMebibytes(stackBytes)}; ` +
    `board after the commands ${formatMebibytes(withoutHistory.bytes)} without a history]`,
  () => {
    bench(
      'undo one step, stack about 1k deep',
      () => {
        if (!history.undo()) throw new Error('nothing to undo');
      },
      UNDOS,
    );

    bench(
      'redo one step, stack about 1k deep',
      () => {
        if (!history.redo()) throw new Error('nothing to redo');
      },
      REDOS,
    );

    bench('moveObjects with the history recording it (redo stack dropped)', () => {
      move(store, targets[0] ?? ('' as ObjectId));
    });

    bench('moveObjects on a board without a history (for comparison)', () => {
      move(withoutHistory.value, targets[0] ?? ('' as ObjectId));
    });
  },
);
