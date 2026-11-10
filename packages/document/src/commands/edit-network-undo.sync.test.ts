// Sync tests of undo after concurrent `editNetwork`s: the network rules a merge can
// break are applied on read (`codec/network-visibility.ts`), never by deleting a member, so an
// undo that brings a vertex back brings back the segments that need it, and no edit is lost
// by the order updates arrive in or by which client id is lower. The last three tests are the
// review's probes (fix round 1): before, the store's repair deleted a segment whose vertex was
// missing when an update arrived, and which segment survived depended on the client ids.
import { describe, expect, it } from 'vitest';

import {
  ADA_ID,
  BOB_ID,
  createClientPair,
  Link,
} from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';

import {
  adaEdits,
  bobEdits,
  changed,
  expectConvergedPath,
  idsOf,
  moved,
  pathOf,
  ZERO,
} from './__fixtures__/network-fixtures.js';

describe.each(ORDERS)('undo after a concurrent network edit ($name)', (order) => {
  it('leaves the other client’s later move of the same vertex', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    adaEdits(ada, { setVertices: [moved(ada, 'v2', 110, 0)] });
    link.deliver();
    bobEdits(bob, { setVertices: [moved(bob, 'v2', 90, 20)] });
    link.deliver();
    history.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(path.vertices[1]).toMatchObject({ x: 90, y: 20 });
  });

  it('removes an inserted vertex’s segment and restores the split one after the other moved it', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const original = pathOf(ada).segments.find(({ id }) => id === 's1');
    adaEdits(ada, {
      setVertices: [{ id: 'v9', x: 50, y: 0, mirror: 'none' }],
      setSegments: [
        changed(ada, 's1', { b: 'v9', hb: ZERO }),
        { id: 's9', a: 'v9', b: 'v2', ha: ZERO, hb: { x: -30, y: -40 } },
      ],
    });
    link.deliver();
    bobEdits(bob, { setVertices: [moved(bob, 'v9', 50, 25)] });
    link.deliver();
    history.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(path.segments.find(({ id }) => id === 's1')).toEqual(original);
    expect(idsOf(path.segments)).toEqual(['s1', 's2']);
  });

  it('hides a segment an undo restores while its vertex is gone, until the vertex is back', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const bobHistory = createHistory(bob, BOB_ID);
    // A closed loop, so deleting s2 alone leaves both its ends joined.
    adaEdits(ada, { setSegments: [{ id: 's3', a: 'v3', b: 'v1', ha: ZERO, hb: ZERO }] });
    link.deliver();
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s2'] });
    bobEdits(bob, { deleteSegmentIds: ['s2', 's3'], deleteVertexIds: ['v3'] });
    link.reconnect();
    history.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.segments)).toEqual(['s1']);
    expect(idsOf(path.vertices)).toEqual(['v1', 'v2']);
    bobHistory.undo();
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1', 's2', 's3']);
  });
});

describe.each(ORDERS)('undo against a concurrent delete ($name)', (order) => {
  it('keeps the segment when one deletes a vertex and undoes it while the other drags its handle', () => {
    // Probe "delete-undo-vs-drag": Bob's client applies Ada's delete before her undo.
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const original = changed(ada, 's2', {});
    const dragged = changed(bob, 's2', { hb: { x: 20, y: -20 } });
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    history.undo();
    bobEdits(bob, { setSegments: [dragged] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v1', 'v2', 'v3']);
    expect(idsOf(path.segments)).toEqual(['s1', 's2']);
    expect([original, dragged]).toContainEqual(path.segments[1]);
  });

  it('brings the dragged segment back when the other undoes the vertex delete', () => {
    // Probe "bob-undo": Ada drags s2's handle while Bob deletes v3 and s2; Ada undoes and redoes
    // her drag, then Bob undoes his delete.
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const adaHistory = createHistory(ada, ADA_ID);
    const bobHistory = createHistory(bob, BOB_ID);
    const dragged = changed(ada, 's2', { hb: { x: 20, y: -20 } });
    link.disconnect();
    adaEdits(ada, { setSegments: [dragged] });
    bobEdits(bob, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    link.reconnect();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1']);
    adaHistory.undo();
    link.deliver();
    adaHistory.redo();
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1']);
    bobHistory.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v1', 'v2', 'v3']);
    expect(path.segments.find(({ id }) => id === 's2')).toEqual(dragged);
  });

  it('closes the loop when one undoes a vertex delete the other had joined to', () => {
    // Probe "del-vs-close-ada-undo": Ada deletes v3 and s2 while Bob joins v3 to v1.
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const adaHistory = createHistory(ada, ADA_ID);
    const bobHistory = createHistory(bob, BOB_ID);
    const closing = { id: 's3', a: 'v3', b: 'v1', ha: ZERO, hb: ZERO };
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    bobEdits(bob, { setSegments: [closing] });
    link.reconnect();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1']);
    adaHistory.undo();
    link.deliver();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.segments)).toEqual(['s1', 's2', 's3']);
    expect(pathOf(ada).segments.find(({ id }) => id === 's3')).toEqual(closing);
    bobHistory.undo();
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['s1', 's2']);
  });

  it('shows the other segment of a pair both joined when the one shown is undone', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const adaHistory = createHistory(ada, ADA_ID);
    link.disconnect();
    adaEdits(ada, { setSegments: [{ id: 'ada-s', a: 'v1', b: 'v3', ha: ZERO, hb: ZERO }] });
    bobEdits(bob, { setSegments: [{ id: 'bob-s', a: 'v3', b: 'v1', ha: ZERO, hb: ZERO }] });
    link.reconnect();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['ada-s', 's1', 's2']);
    adaHistory.undo();
    link.deliver();
    expect(idsOf(expectConvergedPath(ada, bob).segments)).toEqual(['bob-s', 's1', 's2']);
  });
});
