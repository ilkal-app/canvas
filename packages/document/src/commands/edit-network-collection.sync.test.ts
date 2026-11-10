// Sync tests of the members a network write collects (fix round 2;
// `codec/network-collection.ts`): a merge leaves some members stored but hidden by the read
// rules, and the writer's own transaction deletes those its edit makes unable to come back, so
// they do not pile up and one undo step restores them with the edit. Both client id orders.
import { describe, expect, it } from 'vitest';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';

import {
  adaEdits,
  bobEdits,
  changed,
  expectConvergedPath,
  idsOf,
  storedIds,
  ZERO,
} from './__fixtures__/network-fixtures.js';

describe.each(ORDERS)('members a network write collects ($name)', (order) => {
  /**
   * Two linked clients where Ada deleted v3 (and s2) while Bob dragged s2's handle: s2 stays
   * stored with Bob's handle, hidden while v3 is gone.
   *
   * @returns The clients, their link and Ada's history.
   */
  function withHiddenSegment() {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const dragged = changed(bob, 's2', { hb: { x: 20, y: -20 } });
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    bobEdits(bob, { setSegments: [dragged] });
    link.reconnect();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1']);
    expect(storedIds(ada, 'segments')).toEqual(['s1', 's2']);
    return { ada, bob, link, history, dragged };
  }

  it('does not bring back an old segment when a new vertex takes a deleted vertex’s id', () => {
    const { ada, bob, link } = withHiddenSegment();
    // An agent later adds a new vertex it names v3, far away, joined to v1.
    const fresh = { id: 'v3', x: 500, y: 500, mirror: 'none' } as const;
    const joining = { id: 'sX', a: 'v1', b: 'v3', ha: ZERO, hb: ZERO };
    adaEdits(ada, { setVertices: [fresh], setSegments: [joining] });
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.segments)).toEqual(['s1', 'sX']);
    expect(path.vertices.find(({ id }) => id === 'v3')).toEqual(fresh);
    expect(storedIds(bob, 'segments')).toEqual(['s1', 'sX']);
  });

  it('keeps a hidden segment waiting for its other end when a write deletes the end it has', () => {
    // Collecting s2 with v2 would let Ada's undos write her older s2 over Bob's drag
    // (`codec/network-collection.ts`), so s2 stays stored and her undos show his drag whole.
    const { ada, bob, link, history, dragged } = withHiddenSegment();
    adaEdits(ada, { deleteSegmentIds: ['s1'], deleteVertexIds: ['v2'] });
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).vertices)).toEqual(['v1']);
    expect(storedIds(bob, 'segments')).toEqual(['s2']);
    history.undo();
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1']);
    history.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(path.segments.find(({ id }) => id === 's2')).toEqual(dragged);
  });

  it('deletes the hidden duplicate of a pair with the shown one; one undo restores both', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    link.disconnect();
    adaEdits(ada, { setSegments: [{ id: 'ada-s', a: 'v1', b: 'v3', ha: ZERO, hb: ZERO }] });
    bobEdits(bob, { setSegments: [{ id: 'bob-s', a: 'v3', b: 'v1', ha: ZERO, hb: ZERO }] });
    link.reconnect();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['ada-s', 's1', 's2']);
    adaEdits(ada, { deleteSegmentIds: ['ada-s'] });
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1', 's2']);
    expect(storedIds(bob, 'segments')).toEqual(['s1', 's2']);
    history.undo();
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['ada-s', 's1', 's2']);
    expect(storedIds(bob, 'segments')).toEqual(['ada-s', 'bob-s', 's1', 's2']);
  });

  it('deletes the vertex a segment delete leaves joined to nothing; one undo restores it', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    adaEdits(ada, { deleteSegmentIds: ['s2'] });
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).vertices)).toEqual(['v1', 'v2']);
    expect(storedIds(bob, 'vertices')).toEqual(['v1', 'v2']);
    history.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v1', 'v2', 'v3']);
    expect(idsOf(path.segments)).toEqual(['s1', 's2']);
  });
});
