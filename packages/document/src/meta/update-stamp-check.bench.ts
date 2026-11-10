import { bench, describe } from 'vitest';
import * as Y from 'yjs';

import { listAssetIds } from '../assets/list-asset-ids.js';
import { benchSize } from '../store/__fixtures__/bench-size.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';

import { longPath, moveUpdate, noteBoard, writerUpdate } from './__fixtures__/gate-boards.js';
import { alternatingListChain, alternatingTextChain } from './__fixtures__/long-chains.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// Fix round 1: what the relay pays, on its message path, to check an update whose
// origin chains are as long as the update (a text two writers typed, then deleted), and to
// list a snapshot's assets over the same shape. Both follow each item's origins; remembered
// placements keep them linear. Budget: under 50 ms at 16,000 items. CI's smoke run
// (`BENCH_SMOKE=1`) measures 16,000 and 32,000 items.

const HEAVY = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 };

for (const itemCount of [16_000, benchSize({ full: 100_000, smoke: 32_000 })]) {
  const text = alternatingTextChain(itemCount);
  const list = alternatingListChain(itemCount);

  describe(`long alternating chains of ${String(itemCount)} items`, () => {
    bench(
      'UpdateStampCheck: a text two writers typed, then deleted, against an empty board',
      () => {
        new UpdateStampCheck(new Y.Doc()).check(text);
      },
      HEAVY,
    );

    bench(
      'UpdateStampCheck: a list appended to by two writers, against an empty board',
      () => {
        new UpdateStampCheck(new Y.Doc()).check(list);
      },
      HEAVY,
    );

    bench(
      'listAssetIds: a list appended to by two writers',
      () => {
        listAssetIds(list);
      },
      HEAVY,
    );
  });
}

// Part 1: what the relay pays per typical write, the stamp check with the door check of
// the values it writes (placements, sizes, line ends, network members): one note moved on a
// 1,000-note board, and a 1,000-vertex path created on it. One check per hub, as the relay keeps.
describe('typical writes against a 1,000-note board', () => {
  const board = noteBoard(1_000);
  const check = new UpdateStampCheck(board.hub);
  const move = moveUpdate(board, 500);
  const pathBoard = noteBoard(1_000);
  const pathCheck = new UpdateStampCheck(pathBoard.hub);
  const path = writerUpdate(pathBoard, (writer) => {
    writer.transact(BOB, (transaction) => {
      transaction.setObject(longPath(1_000));
    });
  });

  bench('UpdateStampCheck: one note moved', () => {
    check.check(move);
  });

  bench('UpdateStampCheck: a 1,000-vertex path created', () => {
    pathCheck.check(path);
  });
});
