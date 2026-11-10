// Sync tests for `editNetwork` with path data: a replacement takes ids the network does
// not hold, so a peer's concurrent edit of an old member names a member the replacement deleted,
// never one of the new network's. Both clients converge on a readable, well-formed path holding
// the replacement's curves, in both merge orders.
import { describe, expect, it } from 'vitest';

import { createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';

import {
  adaEdits,
  bobEdits,
  expectConvergedPath,
  moved,
  storedIds,
  ZERO,
} from './__fixtures__/network-fixtures.js';

describe.each(ORDERS)('a network replaced by path data ($name)', ({ adaClientId, bobClientId }) => {
  it('keeps the replacement whole while a peer moves an old vertex', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { d: 'M0 0 L10 0 L10 10' });
    bobEdits(bob, { setVertices: [moved(bob, 'v2', 500, 500)] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    // The moved old vertex joins no segment of the replacement, so a read leaves it out.
    expect(path.vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(path.segments).toHaveLength(2);
    expect(path.vertices.map(({ id }) => id)).not.toContain('v2');
  });

  it('never takes the id of a member a merge left hidden', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    // Ada deletes v3 while Bob joins a new vertex to it: Bob's segment is stored but hidden.
    adaEdits(ada, { deleteVertexIds: ['v3'], deleteSegmentIds: ['s2'] });
    bobEdits(bob, {
      setVertices: [{ id: 'v0', x: 300, y: 0, mirror: 'none' }],
      setSegments: [{ id: 's0', a: 'v3', b: 'v0', ha: ZERO, hb: ZERO }],
    });
    link.reconnect();
    expectConvergedPath(ada, bob);
    const storedBefore = new Set([...storedIds(ada, 'vertices'), ...storedIds(ada, 'segments')]);
    expect(storedBefore).toContain('s0');
    link.disconnect();
    adaEdits(ada, { d: 'M0 0 L10 0 L10 10' });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    for (const { id } of [...path.vertices, ...path.segments]) {
      expect(storedBefore.has(id)).toBe(false);
    }
    expect(path.vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });
});
