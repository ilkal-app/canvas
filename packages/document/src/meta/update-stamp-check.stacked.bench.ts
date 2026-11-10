import { bench, describe } from 'vitest';
import * as Y from 'yjs';

import { scanUpdate } from '../assets/update-scan.js';

import { STACKED_CLIENTS_PER_MIB, stackedClientsUpdate } from './__fixtures__/stacked-clients.js';
import { MAX_STAMP_CHECK_STEPS } from './update-stamp-check.js';
import { readUpdateStamps } from './update-stamp-reading.js';

// The absolute counterpart of the structural unit property. Update construction is outside
// timing; scanning and stamp reading match the former unit measurement. This new case uses
// the normal microbenchmark history gate without changing existing references or budgets.
// It asserts nothing until its reference history matures; an unreferenced result is not a pass.
describe('stacked-client stamp replay', () => {
  const update = stackedClientsUpdate(STACKED_CLIENTS_PER_MIB);

  bench(
    `scan and read ${STACKED_CLIENTS_PER_MIB.toLocaleString('en-US')} stacked clients (1 MiB)`,
    () => {
      const doc = new Y.Doc();
      try {
        const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
        readUpdateStamps(doc, update, scan, MAX_STAMP_CHECK_STEPS);
      } finally {
        doc.destroy();
      }
    },
    { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 },
  );
});
