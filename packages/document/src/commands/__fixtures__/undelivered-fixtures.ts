// Helpers of the tests for a path whose segment names a vertex that has not been delivered:
// three stores, real Yjs updates, delivered out of order.
import { expect } from 'vitest';

import { createClientPair } from '../../history/__fixtures__/history-fixtures.js';
import { expectValidAndConverged } from '../../repair/__fixtures__/repair-fixtures.js';
import { exchange, RELAY } from '../../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';

import { adaEdits, bobEdits, ZERO } from './network-fixtures.js';

/** The Yjs client id of the store that receives the segment before the vertex. */
const CARA_CLIENT_ID = 9;

/** The three stores of the scenario and the update Cara has not been given. */
export interface SegmentBeforeVertex {
  /** Wrote the vertex `v4` and the segment `sA` joining it to `v3`. */
  readonly ada: YjsDocumentStore;
  /** Received Ada's edit, then wrote the segment `s3` from `v4` to `v1`. */
  readonly bob: YjsDocumentStore;
  /** Has Bob's update only: `s3` is stored, its vertex `v4` is not. */
  readonly cara: YjsDocumentStore;
  /** Ada's updates, which Cara has not been given (the vertex and `sA`). */
  readonly withheld: readonly Uint8Array[];
}

/**
 * Builds the state of with real updates. Yjs holds an update back until the earlier
 * ones of its own client arrive, so the segment has to come from another client than the vertex:
 * Ada creates the vertex, Bob (who has it) writes a segment onto it, and Cara is given Bob's
 * update alone. Her document then holds the segment `s3` (from `v4` to `v1`) and no `v4`.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's Yjs client id.
 * @returns The stores and Ada's withheld updates.
 */
export function segmentBeforeVertex(adaClientId: number, bobClientId: number): SegmentBeforeVertex {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  const cara = new YjsDocumentStore({ clientId: CARA_CLIENT_ID });
  cara.applyUpdate(ada.encodeState(), RELAY);
  const withheld: Uint8Array[] = [];
  const stopAda = ada.subscribeUpdates((update) => {
    if (update.isLocal) withheld.push(update.update);
  });
  adaEdits(ada, {
    setVertices: [{ id: 'v4', x: 300, y: 0, mirror: 'none' }],
    setSegments: [{ id: 'sA', a: 'v3', b: 'v4', ha: ZERO, hb: ZERO }],
  });
  stopAda();
  for (const update of withheld) bob.applyUpdate(update, RELAY);
  const fromBob: Uint8Array[] = [];
  const stopBob = bob.subscribeUpdates((update) => {
    if (update.isLocal) fromBob.push(update.update);
  });
  bobEdits(bob, { setSegments: [{ id: 's3', a: 'v4', b: 'v1', ha: ZERO, hb: ZERO }] });
  stopBob();
  for (const update of fromBob) cara.applyUpdate(update, RELAY);
  return { ada, bob, cara, withheld };
}

/**
 * Delivers everything to everyone: Cara is given Ada's withheld updates, then the three stores
 * exchange what they lack until they hold the same state (a repair or a formatting clean-up can
 * write again after a delivery).
 *
 * @param scenario - The three stores and the withheld updates.
 */
export function deliverEverything(scenario: SegmentBeforeVertex): void {
  const { ada, bob, cara, withheld } = scenario;
  for (const update of withheld) cara.applyUpdate(update, RELAY);
  const stores = [ada, bob, cara] as const;
  for (let round = 0; round < 4; round += 1) {
    for (const first of stores)
      for (const second of stores) if (first !== second) exchange(first, second);
  }
  expect(bob.encodeState()).toEqual(ada.encodeState());
  expect(cara.encodeState()).toEqual(ada.encodeState());
  expectValidAndConverged(ada, bob);
  expectValidAndConverged(ada, cara);
}
