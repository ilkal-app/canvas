import { bench, describe } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import { createBoard, exportBoard, importBoard } from '@canvas/schema';

// Feasibility floor only: parsing and validating the cached portable projection.
// Cache reads, authorization, worker startup/transfer, fonts and drawing are NOT included.
// If this floor exceeds 500ms, the complete first-paint path cannot meet that budget.
const SIZES = [10_000, 50_000];
const SAMPLES = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 };

for (const size of SIZES) {
  const board = createBoard(createLargeBoardObjects(size, 126));
  const projection = exportBoard(board);
  const json = JSON.stringify(projection);
  describe(`projection floor: ${String(size)} objects, ${String(json.length)} JSON characters`, () => {
    bench(
      'validate structured portable projection',
      () => {
        importBoard(projection);
      },
      SAMPLES,
    );
    bench(
      'clone and validate structured portable projection',
      () => {
        importBoard(structuredClone(projection));
      },
      SAMPLES,
    );
    bench(
      'parse and validate portable projection',
      () => {
        importBoard(JSON.parse(json));
      },
      SAMPLES,
    );
  });
}
