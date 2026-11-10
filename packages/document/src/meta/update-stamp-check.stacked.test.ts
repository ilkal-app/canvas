import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { scanUpdate } from '../assets/update-scan.js';

import { candidateReadLimit, countCandidateReads } from './__fixtures__/candidate-reads.js';
import { replayIntegrationEagerly } from './__fixtures__/eager-set-aside-replay.js';
import { minimumReplayTimes } from './__fixtures__/replay-scaling.js';
import { STACKED_CLIENTS_PER_MIB, stackedClientsUpdate } from './__fixtures__/stacked-clients.js';
import { MAX_STAMP_CHECK_STEPS } from './update-stamp-check.js';
import { readUpdateStamps } from './update-stamp-reading.js';

///264: protect linear replay without an absolute execution-time assertion.
// One struct per client forces many deferred chains into one small update.
// The counter covers candidate-list drain, including derived arrays. The scaling check covers
// the whole scan + stamp read, including refs/maps/stack work the counter cannot observe.
// Measured linear ratio: 1.136x (small batch 63.240ms, large 71.825ms);
// the bounded refs-map quadratic outside candidates failed at 8.437x against the same <3 bound.
// Absolute speed belongs to the microbenchmark; the 60s timeouts bound test liveness only.
// Follow-ups: update-client-bound.test.ts (100ms) and
// update-stamp-check.unprovable.test.ts (5000ms) still need non-clock properties.
describe('the stamp check on stacked structs of many clients', () => {
  it.each([9_500, STACKED_CLIENTS_PER_MIB])(
    'drains %i client candidates in linear work',
    (count) => {
      const update = stackedClientsUpdate(count);
      expect(update.byteLength).toBeLessThanOrEqual(1 << 20);
      const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
      const doc = new Y.Doc();
      const measured = countCandidateReads(count, () =>
        readUpdateStamps(doc, update, scan, MAX_STAMP_CHECK_STEPS),
      );
      expect(measured.lists).toBe(1);
      expect(measured.reads).toBeGreaterThanOrEqual(count);
      expect(measured.reads).toBeLessThanOrEqual(candidateReadLimit(count));
      expect(measured.result.heldBack.size).toBe(count);
      expect(measured.result.isExhausted).toBe(false);
    },
    60_000,
  );

  it('scales equal-work batches of the whole scan and replay below 3x', () => {
    const small = stackedClientsUpdate(9_500);
    const large = stackedClientsUpdate(STACKED_CLIENTS_PER_MIB);
    const times = minimumReplayTimes(small, large);
    expect(times.large / times.small, JSON.stringify(times)).toBeLessThan(3);
  }, 60_000);

  it('rejects the former quadratic filtering replay with bounded work', () => {
    const count = 256;
    const update = stackedClientsUpdate(count);
    const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
    const doc = new Y.Doc();
    expect(() =>
      countCandidateReads(count, () => replayIntegrationEagerly(doc, scan, MAX_STAMP_CHECK_STEPS)),
    ).toThrow('Client candidate reads exceeded the linear bound');
  });
});
