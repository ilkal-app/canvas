// After concurrent network edits merge into a network no single edit could
// write, every client hides the same members and reports the same issues, naming the
// path and the member; the reference repair writes nothing for it on either client.
import { describe, expect, it } from 'vitest';

import { createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import {
  expectValidAndConverged,
  ORDERS,
  recordRepairs,
} from '../repair/__fixtures__/repair-fixtures.js';
import { RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  adaEdits,
  bobEdits,
  changed,
  PATH,
  storedIds,
  ZERO,
} from './__fixtures__/network-fixtures.js';

describe.each(ORDERS)('issues of a merged network ($name)', ({ adaClientId, bobClientId }) => {
  it('reports the segment a vertex delete left dangling, the same on both clients', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const repairs = [recordRepairs(ada), recordRepairs(bob)];
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    bobEdits(bob, { setSegments: [changed(bob, 's2', { hb: { x: 20, y: -20 } })] });
    link.reconnect();
    expectValidAndConverged(ada, bob);
    expect(storedIds(ada, 'segments')).toEqual(['s1', 's2']);
    expect(ada.read().issues).toEqual([
      {
        code: 'hidden-segment',
        key: PATH,
        field: 'segments',
        member: 's2',
        message: 'segments: segment "s2" ends at missing vertex "v3"',
      },
    ]);
    expect(bob.read().issues).toEqual(ada.read().issues);
    const cold = new YjsDocumentStore();
    cold.applyUpdate(ada.encodeState(), RELAY);
    expect(cold.read().issues).toEqual(ada.read().issues);
    // Networks are ruled on read, not repaired: neither client wrote anything for it.
    expect(repairs.map((written) => written.length)).toEqual([0, 0]);
  });

  it('reports the duplicate of a pair both clients joined, the same on both clients', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { setSegments: [{ id: 'ada-s', a: 'v1', b: 'v3', ha: ZERO, hb: ZERO }] });
    bobEdits(bob, { setSegments: [{ id: 'bob-s', a: 'v3', b: 'v1', ha: ZERO, hb: ZERO }] });
    link.reconnect();
    expectValidAndConverged(ada, bob);
    expect(ada.read().issues).toMatchObject([
      { code: 'hidden-segment', key: PATH, member: 'bob-s' },
    ]);
    expect(bob.read().issues).toEqual(ada.read().issues);
  });
});
