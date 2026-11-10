// What the report of hidden network members (`read().issues`) shows for the two undo
// cases split out of. An undo that leaves a stray vertex, now reported on both
// clients as `stray-vertex`; the vertex should be gone, which is's to fix. An
// undo of a re-add raced by the same add leaves no segment dangling on main (the causal undo
// guard, round 2, commit af040693); the report makes a regression visible.
import { describe, expect, it } from 'vitest';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { expectValidAndConverged, ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  adaEdits,
  bobEdits,
  idsOf,
  moved,
  pathOf,
  storedIds,
  ZERO,
} from './__fixtures__/network-fixtures.js';

const V4 = { id: 'v4', x: 300, y: 0, mirror: 'none' as const };
const S3 = { id: 's3', a: 'v3', b: 'v4', ha: ZERO, hb: ZERO };

/**
 *'s sequence: Ada adds v4 and s3, which syncs; offline, Ada undoes and redoes it while
 * Bob moves v4 and then deletes it; they merge, and Ada undoes.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @returns Both stores after Ada's last undo has reached Bob.
 */
function undoAfterMoveThenDelete(
  adaClientId: number,
  bobClientId: number,
): [YjsDocumentStore, YjsDocumentStore] {
  const [ada, bob] = createClientPair(adaClientId, bobClientId);
  const link = new Link(ada, bob);
  const history = createHistory(ada, ADA_ID);
  adaEdits(ada, { setVertices: [V4], setSegments: [S3] });
  link.deliver();
  link.disconnect();
  expect([history.undo(), history.redo()]).toEqual([true, true]);
  bobEdits(bob, { setVertices: [moved(bob, 'v4', 310, 20)] });
  bobEdits(bob, { deleteVertexIds: ['v4'], deleteSegmentIds: ['s3'] });
  link.reconnect();
  expect(history.undo()).toBe(true);
  link.deliver();
  return [ada, bob];
}

describe('a stray vertex after a collaborator’s move-then-delete and an undo', () => {
  it('shows v4 nowhere, and reports it on both clients while it stays stored', () => {
    const [ada, bob] = undoAfterMoveThenDelete(2, 1);
    expectValidAndConverged(ada, bob);
    expect(idsOf(pathOf(ada).vertices)).toEqual(['v1', 'v2', 'v3']);
    expect(storedIds(ada, 'segments')).toEqual(['s1', 's2']);
    expect(ada.read().issues).toEqual([
      {
        code: 'stray-vertex',
        key: 'path-squiggle',
        field: 'vertices',
        member: 'v4',
        message: 'vertices: vertex "v4" is on no segment',
      },
    ]);
  });

  it('removes v4 when Ada’s client id is below Bob’s', () => {
    const [ada, bob] = undoAfterMoveThenDelete(1, 2);
    expectValidAndConverged(ada, bob);
    expect(storedIds(ada, 'vertices')).toEqual(['v1', 'v2', 'v3']);
    expect(ada.read().issues).toEqual([]);
  });

  // Both wanted v4 gone, but when Ada's client id is above Bob's the undo keeps it
  // (Bob's earlier move counts as a write since the step, and his delete leaves nothing for the
  // guard to see). Everything else about the run is asserted above. Remove `.fails` when
  // Lands.
  it.fails('removes v4 when Ada’s client id is above Bob’s', () => {
    const [ada] = undoAfterMoveThenDelete(2, 1);
    expect(storedIds(ada, 'vertices')).toEqual(['v1', 'v2', 'v3']);
  });
});

describe.each(ORDERS)('undo of a re-add raced by the same add ($name)', (order) => {
  it.each([1, 2, 3])('leaves no segment dangling after %i undos', (undos) => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    adaEdits(ada, { setVertices: [V4], setSegments: [S3] });
    adaEdits(ada, { deleteVertexIds: ['v4'], deleteSegmentIds: ['s3'] });
    adaEdits(ada, { setVertices: [V4], setSegments: [S3] });
    const bobSegment = { id: 'bob-s', a: 'v1', b: 'v4', ha: ZERO, hb: ZERO };
    bobEdits(bob, { setVertices: [{ ...V4, x: 500 }], setSegments: [bobSegment] });
    link.reconnect();
    for (let step = 0; step < undos; step += 1) {
      expect(history.undo()).toBe(true);
      link.deliver();
    }
    expectValidAndConverged(ada, bob);
    expect(storedIds(ada, 'vertices')).toContain('v4');
    expect(idsOf(pathOf(ada).segments)).toContain('bob-s');
    expect(ada.read().issues).toEqual([]);
  });
});
