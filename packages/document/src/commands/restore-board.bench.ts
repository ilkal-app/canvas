import { bench, describe } from 'vitest';

import { createSeededIdGenerator } from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { createLargeBoardObjects } from '../synthetic/large-board.js';

import { restoreBoardCommand } from './restore-board.js';
import { runCommand } from './run-command.js';

const objects = createLargeBoardObjects(benchSize({ full: 50_000, smoke: 2_000 }), 92);
const store = new YjsDocumentStore();
for (let start = 0; start < objects.length; start += 1_000)
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects.slice(start, start + 1_000)) transaction.setObject(object);
  });
const before = store.encodeState();
for (let start = 0; start < objects.length; start += 1_000)
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    for (const object of objects.slice(start, start + 1_000))
      transaction.patchObject(object.id, {
        updatedAt: object.updatedAt + 1,
        locked: !object.locked,
      });
  });
const after = store.encodeState();
let isBefore = false;

describe('restore a mixed historical board', () => {
  bench(
    'restoreBoard full validation and grouped application',
    () => {
      const result = runCommand(
        store,
        SYSTEM_ORIGIN,
        restoreBoardCommand,
        { state: isBefore ? after : before },
        {
          clock: () => 1_800_000_000_000,
          createId: createSeededIdGenerator(92),
        },
      );
      if (result.status !== 'applied') throw new Error('Synthetic restore was refused');
      isBefore = !isBefore;
    },
    { iterations: 3, warmupIterations: 1 },
  );
});
