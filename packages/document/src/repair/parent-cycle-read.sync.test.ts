// What a store shows of a parent cycle before its repair runs, or when the repair cannot write:
// the reader applies the repair's choice without writing, so every member and its
// contents are readable, at finite places, and the snapshot reports the member it re-rooted.
// A hostile client's placement naming its own object is a cycle of one.
import { describe, expect, it } from 'vitest';

import { objectToBoardTransform, validateBoard, type BoardObject } from '@canvas/schema';

import { mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { BOB, RELAY } from '../store/__fixtures__/store-fixtures.js';
import type { BoardSnapshot } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { createFrameClients, hostileUpdate, moveInto } from './__fixtures__/cycle-fixtures.js';
import { expectValidAndConverged, ORDERS, recordRepairs } from './__fixtures__/repair-fixtures.js';

/**
 * The snapshot's `parent-cycle` issues.
 *
 * @param snapshot - The snapshot.
 * @returns Its issues of that code.
 */
function cycleIssues(snapshot: BoardSnapshot) {
  return snapshot.issues.filter(({ code }) => code === 'parent-cycle');
}

/**
 * Checks every object's world transform is finite (none throws: no shown chain loops).
 *
 * @param snapshot - The snapshot.
 */
function expectFiniteEverywhere(snapshot: BoardSnapshot): void {
  for (const object of snapshot.objects.values()) {
    const { cos, sin, x, y } = objectToBoardTransform(snapshot, object);
    expect([cos, sin, x, y].every(Number.isFinite)).toBe(true);
  }
}

describe.each(ORDERS)('the reader before the repair ($name)', ({ adaClientId, bobClientId }) => {
  it('shows the lowest-id member at the root where the repair will write it', () => {
    const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
      YjsDocumentStore,
      YjsDocumentStore,
    ];
    const fromAda = ada.encodeStateVector();
    moveInto(ada, 'frame-outer', 'frame-side', { x: 800, y: 0 });
    moveInto(bob, 'frame-side', 'frame-outer', { x: -600, y: 100 }, BOB, NOW + 1_000);
    let seen: BoardSnapshot | undefined;
    bob.subscribe((changes) => {
      if (!changes.isLocal) seen = bob.read();
    });
    bob.applyUpdate(ada.encodeState(fromAda), RELAY);
    if (seen === undefined) throw new Error('no remote change set');
    const shown = seen.objects.get(mustGet(bob, 'frame-outer').id);
    expect(shown?.parentId).toBeNull();
    expect(seen.objects.get(mustGet(bob, 'frame-side').id)?.parentId).toBe('frame-outer');
    expect(cycleIssues(seen)).toEqual([
      expect.objectContaining({ code: 'parent-cycle', key: 'frame-outer', field: 'parentId' }),
    ]);
    expect(validateBoard(seen)).toEqual([]);
    expectFiniteEverywhere(seen);
    // The repair then wrote exactly what was shown: nothing moved when it landed.
    expect(mustGet(bob, 'frame-outer')).toEqual(shown);
    expect(cycleIssues(bob.read())).toEqual([]);
  });
});

describe.each(ORDERS)('a cycle a viewer does not write ($name)', ({ adaClientId, bobClientId }) => {
  it('stays broken on read, reported, until an update breaks it for real', () => {
    const [ada] = createFrameClients([adaClientId, bobClientId]) as [YjsDocumentStore];
    const viewer = new YjsDocumentStore({ repairMode: 'read-only' });
    viewer.applyUpdate(ada.encodeState(), RELAY);
    // A hostile peer closes the cycle and leaves frame-outer with a size no write accepts.
    const update = hostileUpdate(ada, {
      'frame-outer': { placement: { parentId: 'frame-side' }, size: { width: -1 } },
      'frame-side': { placement: { parentId: 'frame-outer' } },
    });
    const repairs = recordRepairs(viewer);
    viewer.applyUpdate(update, RELAY);
    expect(repairs).toEqual([]);
    const snapshot = viewer.read();
    expect(snapshot.objects.get(mustGet(viewer, 'frame-outer').id)?.parentId).toBeNull();
    expect(cycleIssues(snapshot)).toHaveLength(1);
    expect(snapshot.objects.size).toBe(11);
    expectFiniteEverywhere(snapshot);
    // Moving frame-side out (a raw write too, as the viewer writes nothing) ends it.
    viewer.applyUpdate(
      hostileUpdate(viewer, { 'frame-side': { placement: { parentId: null } } }),
      RELAY,
    );
    expect(mustGet(viewer, 'frame-outer').parentId).toBe('frame-side');
    expect(cycleIssues(viewer.read())).toEqual([]);
  });
});

describe.each(ORDERS)(
  'a cycle whose member a peer left invalid ($name)',
  ({ adaClientId, bobClientId }) => {
    it('is repaired by a write that keeps the invalid field', () => {
      const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
        YjsDocumentStore,
        YjsDocumentStore,
      ];
      const update = hostileUpdate(ada, {
        'frame-outer': { placement: { parentId: 'frame-side' }, size: { width: -1 } },
        'frame-side': { placement: { parentId: 'frame-outer' } },
      });
      const repairs = recordRepairs(bob);
      bob.applyUpdate(update, RELAY);
      expect(repairs).toHaveLength(1);
      expect(mustGet(bob, 'frame-outer')).toMatchObject({ parentId: null, width: -1 });
      expect(cycleIssues(bob.read())).toEqual([]);
      expectFiniteEverywhere(bob.read());
    });
  },
);

describe.each(ORDERS)(
  'a placement that names its own object ($name)',
  ({ adaClientId, bobClientId }) => {
    it('is a cycle of one: the object goes to the root at its own placement', () => {
      const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
        YjsDocumentStore,
        YjsDocumentStore,
      ];
      const before: BoardObject = mustGet(bob, 'frame-side');
      const update = hostileUpdate(ada, {
        'frame-side': { placement: { parentId: 'frame-side' } },
      });
      bob.applyUpdate(update, RELAY);
      ada.applyUpdate(update, RELAY);
      expect(mustGet(bob, 'frame-side')).toEqual(before);
      expect(mustGet(bob, 'rect-side').parentId).toBe('frame-side');
      ada.applyUpdate(bob.encodeState(ada.encodeStateVector()), RELAY);
      bob.applyUpdate(ada.encodeState(bob.encodeStateVector()), RELAY);
      expectValidAndConverged(ada, bob);
    });
  },
);

describe('a cycle the reference repair closes', () => {
  it('is broken by a second pass over what the first wrote', () => {
    // frame-inner sits in frame-outer, which Ada puts in frame-side. A hostile peer then deletes
    // frame-outer and puts frame-side into frame-inner: the reference repair takes frame-inner to
    // frame-outer's parent as last seen, frame-side, which now sits in frame-inner.
    const [ada, bob] = createFrameClients([1, 2]) as [YjsDocumentStore, YjsDocumentStore];
    moveInto(ada, 'frame-outer', 'frame-side', { x: 800, y: 0 });
    bob.applyUpdate(ada.encodeState(bob.encodeStateVector()), RELAY);
    const update = hostileUpdate(ada, {
      'frame-outer': null,
      'frame-side': { placement: { parentId: 'frame-inner' } },
    });
    const repairs = recordRepairs(bob);
    bob.applyUpdate(update, RELAY);
    expect(repairs).toHaveLength(2);
    expect(mustGet(bob, 'frame-inner').parentId).toBeNull();
    expect(mustGet(bob, 'frame-side').parentId).toBe('frame-inner');
    expect(cycleIssues(bob.read())).toEqual([]);
    expect(validateBoard(bob.read())).toEqual([]);
  });
});
