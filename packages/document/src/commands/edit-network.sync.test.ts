// Sync tests for `editNetwork`: a path's vertices and segments are members of keyed maps,
// so concurrent edits of different members merge and two edits of one member keep one whole. A
// merge that breaks a network rule (a segment ending at a vertex another client deleted, two
// segments joining one pair, a vertex left with no segment) is not repaired by deleting anything:
// the read leaves those members out (`codec/network-visibility.ts`), so every client holds the same
// board, the path stays readable and its network is well formed, in both merge orders, and a member
// hidden for a while comes back whole with the vertex it needs. Undo is in
// `edit-network-undo.sync.test.ts`.
import { describe, expect, it } from 'vitest';

import { createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
  ORDERS,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import {
  adaEdits,
  bobEdits,
  changed,
  expectConvergedPath,
  idsOf,
  moved,
  PATH,
  ZERO,
} from './__fixtures__/network-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';

describe.each(ORDERS)('concurrent network edits ($name)', ({ adaClientId, bobClientId }) => {
  it('keeps both moves when two clients move different vertices', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { setVertices: [moved(ada, 'v1', -10, -10)] });
    bobEdits(bob, { setVertices: [moved(bob, 'v3', 210, 60)] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(path.vertices.map(({ x, y }) => [x, y])).toEqual([
      [-10, -10],
      [100, 0],
      [210, 60],
    ]);
  });

  it('keeps one whole value when two clients move the same vertex', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { setVertices: [moved(ada, 'v2', 110, 5)] });
    bobEdits(bob, { setVertices: [moved(bob, 'v2', 90, -5)] });
    link.reconnect();
    const vertex = expectConvergedPath(ada, bob).vertices[1];
    expect([
      [110, 5],
      [90, -5],
    ]).toContainEqual([vertex?.x, vertex?.y]);
  });

  it('keeps the move and the delete when one moves a vertex and the other deletes its segment', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { setVertices: [moved(ada, 'v2', 100, 30)] });
    bobEdits(bob, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v1', 'v2']);
    expect(idsOf(path.segments)).toEqual(['s1']);
    expect(path.vertices[1]).toMatchObject({ x: 100, y: 30 });
  });

  it('hides the dragged segment when one deletes a vertex while the other drags its handle', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s2'], deleteVertexIds: ['v3'] });
    // Bob drags the handle at v3's end of s2.
    bobEdits(bob, { setSegments: [changed(bob, 's2', { hb: { x: 20, y: -20 } })] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v1', 'v2']);
    expect(idsOf(path.segments)).toEqual(['s1']);
  });

  it('keeps a mirrored handle drag whole when the other deletes the vertex across it', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { deleteSegmentIds: ['s1'], deleteVertexIds: ['v1'] });
    // Bob drags v2's handle on s2; v2 mirrors 'both', so s1's handle at v2 follows.
    bobEdits(bob, {
      setSegments: [
        changed(bob, 's2', { ha: { x: 50, y: 0 } }),
        changed(bob, 's1', { hb: { x: -50, y: 0 } }),
      ],
    });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v2', 'v3']);
    expect(path.segments).toEqual([changed(bob, 's2', {})]);
    expect(path.segments[0]?.ha).toEqual({ x: 50, y: 0 });
  });

  it('keeps the other client’s delete when one inserts a vertex on a segment it deletes', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    // Ada splits s1 at v9; Bob deletes v1, and s1 with it.
    adaEdits(ada, {
      setVertices: [{ id: 'v9', x: 50, y: 0, mirror: 'none' }],
      setSegments: [
        changed(ada, 's1', { b: 'v9', hb: ZERO }),
        { id: 's9', a: 'v9', b: 'v2', ha: ZERO, hb: { x: -30, y: -40 } },
      ],
    });
    bobEdits(bob, { deleteSegmentIds: ['s1'], deleteVertexIds: ['v1'] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.vertices)).toEqual(['v2', 'v3', 'v9']);
    expect(idsOf(path.segments)).toEqual(['s2', 's9']);
  });

  it('keeps one of the two writes of a segment when one splits it and the other drags a handle', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, {
      setVertices: [{ id: 'v9', x: 50, y: 0, mirror: 'none' }],
      setSegments: [
        changed(ada, 's1', { b: 'v9', hb: ZERO }),
        { id: 's9', a: 'v9', b: 'v2', ha: ZERO, hb: { x: -30, y: -40 } },
      ],
    });
    bobEdits(bob, { setSegments: [changed(bob, 's1', { ha: { x: 0, y: 40 } })] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    expect(idsOf(path.segments)).toEqual(['s1', 's2', 's9']);
  });

  it('keeps one segment when both clients join the same pair of vertices', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { setSegments: [{ id: 'ada-s', a: 'v1', b: 'v3', ha: ZERO, hb: ZERO }] });
    bobEdits(bob, { setSegments: [{ id: 'bob-s', a: 'v3', b: 'v1', ha: ZERO, hb: ZERO }] });
    link.reconnect();
    const path = expectConvergedPath(ada, bob);
    // The read shows the segment with the lowest id, on every client.
    expect(idsOf(path.segments)).toEqual(['ada-s', 's1', 's2']);
  });

  it('converges on the deletion when one edits a path the other deletes', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    link.disconnect();
    adaEdits(ada, { setVertices: [moved(ada, 'v2', 100, 30)] });
    applyCommand(bob, deleteObjectsCommand, { ids: [PATH] }, BOB, BOB_ENVIRONMENT);
    link.reconnect();
    expectValidAndConverged(ada, bob);
    expect(ada.read().objects.has(PATH as never)).toBe(false);
  });
});
