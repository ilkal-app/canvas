import { bench, describe } from 'vitest';
import type { z } from 'zod';

import { createSeededIdGenerator, type ObjectId, type ShapeObject } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import type { CommandContext } from './command.js';
import { createFrameCommand, createFrameInputSchema } from './create-frame.js';
import { runCommand } from './run-command.js';

// Drawing a frame over 1,000 objects: the frame tool
// creates the frame and takes every object inside it in one command, one transaction, on the
// seeded 10k-object board with 1,000 loose shapes on its root. `validate` is the command's own
// work (the frame checked, each object's placement converted into the frame, keys on top of
// the frame's children, each object checked); the full command adds the Yjs transaction. Each
// run takes the same shapes into a new frame (out of the previous run's), so no setup is timed.
// CI's smoke run (`BENCH_SMOKE=1`) uses a 2k-object board and 100 shapes.

const BOARD_SIZE = benchSize({ full: 10_000, smoke: 2_000 });
const ADOPTED = benchSize({ full: 1_000, smoke: 100 });

/**
 * One loose shape on the root, on a grid of 60 world units.
 *
 * @param index - Its index.
 * @returns The shape.
 */
function looseShape(index: number): ShapeObject {
  return {
    id: `loose-${String(index)}` as ObjectId,
    type: 'shape',
    parentId: null,
    x: 20_000 + (index % 40) * 60,
    y: 20_000 + Math.floor(index / 40) * 60,
    rotation: 0,
    z: `d${String(index).padStart(4, '0')}`,
    locked: false,
    createdBy: SYSTEM_ORIGIN.principalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    width: 50,
    height: 50,
    kind: 'rectangle',
    stroke: null,
    fill: [0.2, 0.4, 0.8, 1],
    cornerRadius: 4,
    sides: 4,
    label: null,
  };
}

const store = new YjsDocumentStore();
const shapes = [...Array(ADOPTED).keys()].map(looseShape);
store.transact(SYSTEM_ORIGIN, (transaction) => {
  for (const object of createLargeBoardObjects(BOARD_SIZE, 83)) transaction.setObject(object);
  for (const shape of shapes) transaction.setObject(shape);
});
const frame = {
  type: 'frame',
  x: 19_990,
  y: 19_990,
  width: 2_420,
  height: Math.ceil(ADOPTED / 40) * 60 + 20,
  name: 'Frame 1',
  clip: false,
  background: [1, 1, 1, 1],
};
const childIds = shapes.map(({ id }) => id);
const input = createFrameInputSchema.parse({ frame, childIds });
/** The same input as `runCommand` takes it: parsed again on every run, as the tool's is. */
const unparsed = { frame, childIds } as unknown as z.input<typeof createFrameInputSchema>;
const environment = { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(8_301) };
const context: CommandContext = {
  board: store,
  origin: SYSTEM_ORIGIN,
  now: 1_770_000_000_000,
  createId: createSeededIdGenerator(8_302),
};

describe(`draw a frame over ${String(ADOPTED)} objects on a ${String(BOARD_SIZE)}-object board`, () => {
  bench('createFrame validate: the frame, conversions, keys and checks', () => {
    if (!createFrameCommand.validate(context, input).isValid) throw new Error('rejected');
  });

  bench('createFrame through runCommand: validate plus the Yjs transaction', () => {
    const outcome = runCommand(store, SYSTEM_ORIGIN, createFrameCommand, unparsed, environment);
    if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome.errors));
  });
});
