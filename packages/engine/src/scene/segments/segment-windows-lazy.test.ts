import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { CullRangeChange } from '../scene-culler.js';

import { checkMovedObjects } from './segment-moves.js';
import { planSegmentDraws } from './segment-plan.js';
import { SegmentWindow } from './segment-window.js';
import { SegmentWindows } from './segment-windows.js';

function fixture() {
  const passes = ['shape', 'text'].map((name) => ({
    name,
    owners: {
      rankOfSlot: Int32Array.from({ length: 20 }, (unused, rank) => rank),
      recordOfSlot: new Int32Array(20),
    },
  }));
  const visible = passes.map(({ name }) => ({
    passName: name,
    ranges: [
      { start: 0, count: 10 },
      { start: 11, count: 9 },
    ],
  }));
  const input = { passes, visible, isOccluderByRank: new Uint8Array(20).fill(1) };
  const changes = new Map<string, CullRangeChange>(
    passes.map(({ name }) => [
      name,
      {
        source: {},
        revision: 0,
        previousRevision: -1,
        added: [],
        removed: [],
      },
    ]),
  );
  const plan = planSegmentDraws(input);
  const cache = new SegmentWindows(
    plan,
    input,
    (name) => changes.get(name),
    (rank) => [rank],
  );
  const change = (start: number, isAdded: boolean): void => {
    for (const [name, old] of changes)
      changes.set(name, {
        ...old,
        previousRevision: old.revision,
        revision: old.revision + 1,
        added: isAdded ? [{ start, count: 1 }] : [],
        removed: isAdded ? [] : [{ start, count: 1 }],
      });
  };
  return { cache, changes, change, input, plan };
}

it('defers interval discovery across unchanged observations without changing move metadata', () => {
  const { cache, plan } = fixture();
  const before = {
    masks: plan.passMaskByRank.slice(),
    segments: plan.segmentOfRank.slice(),
    splits: plan.splitOfRank.slice(),
  };
  for (let frame = 0; frame < 100; frame += 1) cache.observe();
  expect(cache.counts).toMatchObject({ graphBuilds: 0, windowsBuilt: 0, removalBuilds: 0 });
  expect(plan.passMaskByRank).toEqual(before.masks);
  expect(plan.segmentOfRank).toEqual(before.segments);
  expect(plan.splitOfRank).toEqual(before.splits);
});

it.each(['source', 'revision', 'missing'] as const)(
  'refuses %s before allocating the graph',
  (kind) => {
    const { cache, changes, change } = fixture();
    change(10, true);
    const old = changes.get('text');
    if (!old) throw new Error('Missing pass');
    if (kind === 'source') changes.set('text', { ...old, source: {} });
    if (kind === 'revision') changes.set('text', { ...old, revision: old.revision + 1 });
    if (kind === 'missing') changes.delete('text');
    expect(cache.patch()).toBeUndefined();
    expect(cache.counts).toMatchObject({ graphBuilds: 0, windowsBuilt: 0, removalBuilds: 0 });
  },
);

it('shifts discovery to the first eligible patch and initializes only affected removal state', () => {
  const { cache, change, input } = fixture();
  expect(cache.counts).toMatchObject({ graphBuilds: 0, windowsBuilt: 0, removalBuilds: 0 });
  // The renderer reuses this borrowed array for the next cull result. Discover old intervals
  // from the retained full plan, not from this already changed view.
  for (const entry of input.visible) entry.ranges = [{ start: 0, count: 20 }];
  change(10, true);
  const added = cache.patch();
  expect(added?.entries).toEqual(planSegmentDraws(input).entries);
  // Only the windows a delta reaches build their tables: here the two that repairing
  // rank 10's interval makes, not the twenty the old plan had.
  expect(cache.counts).toMatchObject({ graphBuilds: 1, windowsBuilt: 2, removalBuilds: 0 });
  const oldEntries = JSON.stringify(added?.entries);
  change(10, false);
  expect(cache.patch()).toBeDefined();
  expect(cache.counts).toMatchObject({ graphBuilds: 1, windowsBuilt: 2, removalBuilds: 1 });
  expect(JSON.stringify(added?.entries)).toBe(oldEntries);
  // Removing another pass record in a different interval must build one more local state.
  change(11, false);
  expect(cache.patch()).toBeDefined();
  expect(cache.counts).toMatchObject({ graphBuilds: 1, windowsBuilt: 3, removalBuilds: 2 });
});

it('counts unique owned records through bridges and duplicate ranges before lazy removal', () => {
  const owners = {
    rankOfSlot: Int32Array.of(0, 0, -1, 1, 2, 2, -1, 3),
    recordOfSlot: new Int32Array(8),
  };
  const pass = { name: 'shape', owners };
  const input = {
    passes: [pass],
    visible: [{ passName: 'shape', ranges: [{ start: 0, count: 8 }] }],
    isOccluderByRank: new Uint8Array(4),
  };
  const full = planSegmentDraws(input);
  const plan = {
    ...full,
    entries: [...input.visible, { passName: 'shape', ranges: [{ start: 1, count: 5 }] }],
  };
  const window = new SegmentWindow(0, 4, 0, plan, input, (rank) =>
    Array.from(owners.rankOfSlot, (owner, slot) => (owner === rank ? slot : -1)).filter(
      (slot) => slot >= 0,
    ),
  );
  expect(window.liveRecords).toBe(6);
  expect(window.hasRemovalState).toBe(false);
  window.remove(new Map([['shape', { added: [], removed: [{ start: 0, count: 1 }] }]]));
  expect(window.liveRecords).toBe(5);
  expect(window.hasRemovalState).toBe(true);
  window.remove(new Map([['shape', { added: [], removed: [{ start: 1, count: 1 }] }]]));
  expect(window.liveRecords).toBe(4);
  expect(window.plan.passMaskByRank[0]).toBe(0);
});

it('keeps pure-plan move checks active before the first coverage delta', () => {
  const passes = ['shape', 'text'].map((name) => ({
    name,
    owners: {
      rankOfSlot: Int32Array.of(0, 1),
      recordOfSlot: new Int32Array(2),
    },
  }));
  const bounds = (x: number) => ({ minX: x, minY: 0, maxX: x + 10, maxY: 10 });
  const input = {
    passes,
    visible: passes.map(({ name }) => ({ passName: name, ranges: [{ start: 0, count: 2 }] })),
    isOccluderByRank: new Uint8Array(2).fill(1),
    boundsOfRank: (rank: number) => bounds(rank * 100),
  };
  const plan = planSegmentDraws(input);
  expect(plan.hasSpatialMerges).toBe(true);
  const cursor = { source: {}, revision: 0, previousRevision: -1, added: [], removed: [] };
  const cache = new SegmentWindows(
    plan,
    input,
    () => cursor,
    (rank) => [rank],
  );
  cache.observe();
  expect(
    checkMovedObjects(
      plan,
      ['b' as ObjectId],
      (id) => (id === 'a' ? 0 : 1),
      {
        boundsOf: (id) => bounds(id === 'a' ? 0 : 5),
        searchRect: () => ['a', 'b'] as ObjectId[],
      },
      256,
    ),
  ).toBe('broken');
  expect(cache.counts).toMatchObject({ graphBuilds: 0, windowsBuilt: 0, removalBuilds: 0 });
});

it('advances empty deltas without constructing an interval graph', () => {
  const { cache, changes } = fixture();
  for (const [name, old] of changes)
    changes.set(name, { ...old, revision: 1, previousRevision: 0 });
  expect(cache.patch()).toBeDefined();
  expect(cache.counts).toMatchObject({ graphBuilds: 0, windowsBuilt: 0, removalBuilds: 0 });
});
