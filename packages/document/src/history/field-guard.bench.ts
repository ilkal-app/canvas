import { afterAll, bench, describe } from 'vitest';

import { createGuardedLabel } from './__fixtures__/guarded-label.js';

// A bounded real-history workload: each measured undo has its own prepared label race.
// Preparation and disposal stay outside timing; no repeated undo of an already consumed step.
// This measures the whole undo, not just the memo lookup. Existing guard counter regressions
// establish the removed repeated walk; these timings alone do not establish a speedup.
for (const characters of [1, 64]) {
  describe(`guarded label undo, ${String(characters)} independently formatted characters`, () => {
    const fixtures = Array.from({ length: 24 }, () => createGuardedLabel(characters));
    let next = 0;
    afterAll(() => {
      for (const { history, ada, bob } of fixtures) {
        history.destroy();
        ada.destroy();
        bob.destroy();
      }
    });
    bench(
      'undo one winning concurrent label without hollowing its children',
      () => {
        const fixture = fixtures[next++];
        if (fixture === undefined) throw new Error('Prepared label races exhausted');
        fixture.history.undo();
      },
      { time: 0, iterations: 16, warmupTime: 0, warmupIterations: 0 },
    );
  });
}
