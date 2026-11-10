import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { scanUpdate } from '../assets/update-scan.js';
import { pendingSeed2354 } from '../store/__fixtures__/pending-seed-2354.js';
import { createSeededRandom } from '../z-order/__fixtures__/seeded-random.js';

import { replayIntegrationEagerly } from './__fixtures__/eager-set-aside-replay.js';
import { encodeHandUpdate } from './__fixtures__/hand-encoded-update.js';
import { randomReplayCase } from './__fixtures__/random-multi-client-update.js';
import { stackedClientsUpdate } from './__fixtures__/stacked-clients.js';
import { relayHolding } from './__fixtures__/stamp-check-fixtures.js';
import { replayIntegration, type IntegrationReplay } from './update-integration.js';

// The replay's set-aside no longer filters the list of clients left once per stacked
// item (quadratic in the stack); it leaves set-aside clients in the list and skips them when
// they come up. The order in which Yjs takes clients must not change, so the replay must say
// exactly what the pre- replay said (`replayIntegrationEagerly`), in the same order, on
// every update: random ones of many clients,'s pinned seed, and stacked chains.

/** How many random cases run. */
const RANDOM_CASES = 3_000;

/**
 * A replay as plain data, in its own order: each landing's item and place (the parent by
 * identity), the clients held back, the states read, and the two flags.
 *
 * @param replay - The replay.
 * @returns Its description.
 */
function describeReplay(replay: IntegrationReplay): unknown {
  return {
    landings: [...replay.landings].map(([item, landing]) => [
      item,
      landing.isCollected,
      landing.parentName,
      landing.parentSub,
    ]),
    parents: [...replay.landings.values()].map((landing) => landing.parent),
    heldBack: [...replay.heldBack],
    initialStates: [...replay.initialStates],
    isMalformed: replay.isMalformed,
    isExhausted: replay.isExhausted,
  };
}

/**
 * Replays one update both ways over the same scan and expects the same answer.
 *
 * @param doc - The document.
 * @param update - The update.
 * @param maxSteps - The work ceiling.
 * @returns The linear replay's answer.
 */
function expectSameReplay(doc: Y.Doc, update: Uint8Array, maxSteps = 1_000_000): IntegrationReplay {
  const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
  const linear = replayIntegration(doc, scan, maxSteps);
  const eager = replayIntegrationEagerly(doc, scan, maxSteps);
  expect(describeReplay(linear)).toEqual(describeReplay(eager));
  const parents = [...linear.landings.values()].map((landing) => landing.parent);
  expect(parents).toStrictEqual([...eager.landings.values()].map((landing) => landing.parent));
  return linear;
}

describe('the linear set-aside replays exactly what the quadratic one did', () => {
  it(`on ${String(RANDOM_CASES)} random updates of many clients`, () => {
    let heldBack = 0;
    for (let seed = 1; seed <= RANDOM_CASES; seed += 1) {
      const { doc, update, maxSteps } = randomReplayCase(createSeededRandom(seed));
      let replay: IntegrationReplay | undefined;
      try {
        replay = expectSameReplay(doc, update, maxSteps);
      } catch (error) {
        throw new Error(`seed ${String(seed)}`, { cause: error });
      }
      if (replay.heldBack.size > 1) heldBack += 1;
    }
    // The cases must reach the set-aside of more than one stacked client, often.
    expect(heldBack).toBeGreaterThan(RANDOM_CASES / 10);
  });

  it('on every delivery of seed 2354, in order', () => {
    const doc = new Y.Doc();
    for (const update of pendingSeed2354()) {
      expectSameReplay(doc, update);
      Y.applyUpdate(doc, update);
    }
  });

  it('on stacked chains, set aside or integrated once the missing client is held', () => {
    const lowest = encodeHandUpdate([
      {
        client: 0,
        clock: 0,
        structs: [{ parent: 'notes', content: { kind: 'deleted', length: 1 } }],
      },
    ]);
    for (const clientCount of [1, 2, 3, 50, 2_000]) {
      const update = stackedClientsUpdate(clientCount);
      expect(expectSameReplay(new Y.Doc(), update).heldBack.size).toBe(clientCount);
      expect(expectSameReplay(relayHolding(lowest), update).landings.size).toBe(clientCount);
      expect(expectSameReplay(new Y.Doc(), Y.mergeUpdates([lowest, update])).heldBack.size).toBe(0);
    }
  });
});
