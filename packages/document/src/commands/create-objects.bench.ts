import { bench, describe } from 'vitest';
import type { z } from 'zod';

import { createSeededIdGenerator } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { BODY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import type { CommandContext } from './command.js';
import { createObjectsCommand, createObjectsInputSchema } from './create-objects.js';
import { runCommand } from './run-command.js';

// Pasting 1,000 objects (a paste is one
// command, one transaction, one frame's worth of change set): groups of shapes, a styled text
// and a connector per group, onto the seeded large board. `validate` is the command's own work
// (ids, remapping, keys on top of the root, each object checked, references checked on the
// sub-board of the paste); the full command adds the Yjs transaction. Each iteration pastes the
// same list again with fresh ids, so no setup is timed. CI's smoke run (`BENCH_SMOKE=1`) uses a
// 2k-object board and pastes 100 objects.

const BOARD_SIZE = benchSize({ full: 10_000, smoke: 2_000 });
const PASTE_SIZE = benchSize({ full: 1_000, smoke: 100 });
/** Objects per pasted group: the group, eight shapes, a text and a connector. */
const GROUP_SIZE = 11;

/**
 * One pasted group: a group of eight shapes, a two-run text and a connector between two of the
 * shapes, listed under ids local to the paste.
 *
 * @param index - The group's index.
 * @returns The listed objects, bottom first.
 */
function pastedGroup(index: number): Record<string, unknown>[] {
  const groupId = `g${String(index)}`;
  const shapeId = (shape: number) => `g${String(index)}s${String(shape)}`;
  const shapes = [...Array(GROUP_SIZE - 3).keys()].map((shape) => ({
    type: 'shape',
    id: shapeId(shape),
    parentId: groupId,
    x: shape * 60,
    y: 0,
    width: 50,
    height: 50,
    kind: 'rectangle',
    stroke: null,
    fill: [0.2, 0.4, 0.8, 1],
    cornerRadius: 4,
    sides: 4,
    label: null,
  }));
  const text = {
    type: 'text',
    id: `g${String(index)}t`,
    parentId: groupId,
    x: 0,
    y: 60,
    width: 200,
    height: 24,
    text: 'Bold plain',
    runs: [
      { length: 5, style: { ...BODY, weight: 700 } },
      { length: 5, style: BODY },
    ],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
  const connector = {
    type: 'connector',
    id: `g${String(index)}c`,
    parentId: groupId,
    x: 0,
    y: 0,
    from: { kind: 'object', objectId: shapeId(0), anchor: null },
    to: { kind: 'object', objectId: shapeId(1), anchor: null },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
  const group = {
    type: 'group',
    id: groupId,
    x: (index % 10) * 600,
    y: Math.floor(index / 10) * 200,
  };
  return [group, ...shapes, text, connector];
}

const store = new YjsDocumentStore();
store.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of createLargeBoardObjects(BOARD_SIZE, 82)) transaction.setObject(object);
});
const objects = [...Array(Math.ceil(PASTE_SIZE / GROUP_SIZE)).keys()]
  .flatMap(pastedGroup)
  .slice(0, PASTE_SIZE);
const input = createObjectsInputSchema.parse({ objects });
/** The same list as `runCommand` takes it: parsed again on every run, as a paste is. */
const unparsed = { objects } as unknown as z.input<typeof createObjectsInputSchema>;
const environment = { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(8_201) };
const context: CommandContext = {
  board: store,
  origin: SYSTEM_ORIGIN,
  now: 1_770_000_000_000,
  createId: createSeededIdGenerator(8_202),
};

describe(`paste ${String(PASTE_SIZE)} objects onto a ${String(BOARD_SIZE)}-object board`, () => {
  bench('createObjects validate: ids, remapping, keys and checks', () => {
    if (!createObjectsCommand.validate(context, input).isValid) throw new Error('rejected');
  });

  bench('createObjects through runCommand: validate plus the Yjs transaction', () => {
    const outcome = runCommand(store, SYSTEM_ORIGIN, createObjectsCommand, unparsed, environment);
    if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome.errors));
  });
});
