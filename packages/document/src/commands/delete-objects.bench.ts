import { bench, describe } from 'vitest';

import { cascadeDelete, type BoardObject, type ObjectId } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import type { CommandContext } from './command.js';
import { deleteObjectsCommand, deleteObjectsInputSchema } from './delete-objects.js';
import { runCommand } from './run-command.js';

// Deleting a 1k-child group on a 50k-object board: the command
// gathers what the schema's `cascadeDelete` reads through the store's reverse indexes, so its
// cost follows the deletion; the schema rule on the whole board is O(n) and is measured beside
// it for comparison on the same work: planning what to delete and detach. The full command adds
// the Yjs transaction that deletes about 25k Yjs items (1k shapes with their fields and labels).
// The board is the seeded large board plus GROUP_COUNT groups of CHILD_COUNT shapes, each
// with CONNECTOR_COUNT connectors attached to its children from outside. Each iteration of the
// full command deletes the next group, so no setup is timed. CI's smoke run (`BENCH_SMOKE=1`)
// shrinks the board to 2k objects and the groups to 100 children with 5 connectors.

const BOARD_SIZE = benchSize({ full: 50_000, smoke: 2_000 });
const GROUP_COUNT = 10;
const CHILD_COUNT = benchSize({ full: 1_000, smoke: 100 });
/** One connector per this many children, attached to every such child from outside. */
const CHILDREN_PER_CONNECTOR = 20;
const CONNECTOR_COUNT = CHILD_COUNT / CHILDREN_PER_CONNECTOR;
const GROUPS_TOTAL = GROUP_COUNT * (1 + CHILD_COUNT + CONNECTOR_COUNT);

/**
 * Builds one group of shapes and the connectors attached to it.
 *
 * @param index - The group's index.
 * @returns The group, its children and the connectors.
 */
function groupObjects(index: number): BoardObject[] {
  const group = fixtureObject('group-diagram', 'group');
  const shape = fixtureObject('shape-box', 'shape');
  const connector = fixtureObject('connector-flow', 'connector');
  const groupId = `bench-group-${String(index)}` as ObjectId;
  const childId = (child: number) => `bench-${String(index)}-${String(child)}` as ObjectId;
  const children = [...Array(CHILD_COUNT).keys()].map((child): BoardObject => ({
    ...shape,
    id: childId(child),
    parentId: groupId,
    x: (child % 40) * 200,
    y: Math.floor(child / 40) * 150,
    // Integer keys: head `c` states three digits, so `c000` to `c999` are fractional-index keys.
    z: `c${String(child).padStart(3, '0')}`,
  }));
  const connectors = [...Array(CONNECTOR_COUNT).keys()].map((end): BoardObject => ({
    ...connector,
    id: `bench-${String(index)}-connector-${String(end)}` as ObjectId,
    from: { kind: 'object', objectId: childId(end * CHILDREN_PER_CONNECTOR), anchor: null },
    to: { kind: 'point', x: 0, y: 0 },
  }));
  return [{ ...group, id: groupId, parentId: null, x: index * 10_000 }, ...children, ...connectors];
}

const store = new YjsDocumentStore();
store.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of createLargeBoardObjects(BOARD_SIZE - GROUPS_TOTAL, 46)) {
    transaction.setObject(object);
  }
  for (let index = 0; index < GROUP_COUNT; index += 1) {
    for (const object of groupObjects(index)) transaction.setObject(object);
  }
});
const snapshot = store.read();
const environment = testEnvironment();
const context: CommandContext = {
  board: store,
  origin: SYSTEM_ORIGIN,
  now: 1_770_000_000_000,
  createId: environment.createId,
};
const firstGroup = deleteObjectsInputSchema.parse({ ids: ['bench-group-0'] });
let nextGroup = 1;

describe(`delete a ${String(CHILD_COUNT)}-child group on a ${String(snapshot.objects.size)}-object board`, () => {
  bench('deleteObjects validate: the cascade planned through the reverse indexes', () => {
    if (!deleteObjectsCommand.validate(context, firstGroup).isValid) throw new Error('rejected');
  });

  bench('schema cascadeDelete on the whole board (the O(n) rule, for comparison)', () => {
    cascadeDelete(snapshot, firstGroup.ids);
  });

  bench(
    'deleteObjects through runCommand: validate plus the Yjs transaction',
    () => {
      const groupId = `bench-group-${String(nextGroup)}`;
      nextGroup += 1;
      const input = { ids: [groupId] };
      const outcome = runCommand(store, SYSTEM_ORIGIN, deleteObjectsCommand, input, environment);
      if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome.errors));
    },
    // Fewer iterations than groups: the runner may call the function once more to warm up.
    { time: 0, iterations: GROUP_COUNT - 3, warmupTime: 0, warmupIterations: 0 },
  );
});
