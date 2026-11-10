import { expect, it } from 'vitest';

import type { CullRangeChange } from '../scene-culler.js';

import { planSegmentDraws, type SegmentPlanInput } from './segment-plan.js';
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
  const input: SegmentPlanInput = {
    passes,
    visible,
    isOccluderByRank: new Uint8Array(20).fill(1),
    boundsOfRank: () => ({ minX: 0, minY: 0, maxX: 20, maxY: 20 }),
  };
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
  const cache = new SegmentWindows(
    planSegmentDraws(input),
    input,
    (name) => changes.get(name),
    (rank) => [rank],
  );
  const add = (start: number, count: number) => {
    for (const [name, change] of changes)
      changes.set(name, {
        ...change,
        revision: change.revision + 1,
        previousRevision: change.revision,
        added: [{ start, count }],
        removed: [],
      });
  };
  return { cache, changes, input, add };
}

it('repairs the complete small old segment interval for an entering rank', () => {
  const { cache, input, add } = fixture();
  add(10, 1);
  const patched = cache.patch();
  const expected = planSegmentDraws({
    ...input,
    visible: input.passes.map(({ name }) => ({
      passName: name,
      ranges: [{ start: 0, count: 20 }],
    })),
  });
  expect(patched?.entries).toEqual(expected.entries);
  expect(patched?.passMaskByRank).toEqual(expected.passMaskByRank);
  expect(cache.counts.repairs).toBe(1);
  expect(cache.counts.plannedRecords).toBe(4);
});

it('retains source/revision refusal before interval mutation', () => {
  const { cache, changes, add } = fixture();
  add(10, 1);
  const last = changes.get('text');
  if (!last) throw new Error('Missing pass');
  changes.set('text', { ...last, source: {} });
  expect(cache.patch()).toBeUndefined();
  expect(cache.counts.repairs).toBe(0);
});

it('requests full planning for an entering interval covering at least half the live records', () => {
  const { input } = fixture();
  const pass = input.passes[0];
  if (!pass) throw new Error('Missing pass');
  const single = { ...input, passes: [pass] };
  let change: CullRangeChange = {
    source: {},
    revision: 0,
    previousRevision: -1,
    added: [],
    removed: [],
  };
  const cache = new SegmentWindows(
    planSegmentDraws({
      ...single,
      visible: [input.visible[0] ?? { passName: pass.name, ranges: [] }],
    }),
    single,
    () => change,
    (rank) => [rank],
  );
  change = { ...change, revision: 1, previousRevision: 0, added: [{ start: 10, count: 1 }] };
  expect(cache.patch()).toBeUndefined();
  expect(cache.counts).toMatchObject({ repairs: 0, wideFallbacks: 1 });
});

it('compacts actual range growth and resets the watermark even when physical holes remain', () => {
  const owners = {
    rankOfSlot: Int32Array.from({ length: 400 }, (unused, rank) => rank),
    recordOfSlot: new Int32Array(400),
  };
  const pass = { name: 'shape', owners };
  let visible = [{ passName: 'shape', ranges: [{ start: 0, count: 400 }] }];
  const input = () => ({ passes: [pass], visible, isOccluderByRank: new Uint8Array(400) });
  let change: CullRangeChange = {
    source: {},
    revision: 0,
    previousRevision: -1,
    added: [],
    removed: [],
  };
  const create = () =>
    new SegmentWindows(
      planSegmentDraws(input()),
      input(),
      () => change,
      (rank) => [rank],
    );
  let cache = create();
  const removed = Array.from({ length: 130 }, (unused, index) => ({
    start: index * 2 + 1,
    count: 1,
  }));
  change = { ...change, revision: 1, previousRevision: 0, removed: removed.slice(0, 128) };
  expect(cache.patch()?.entries[0]?.ranges).toHaveLength(129);
  expect(cache.counts.compactions).toBe(0);
  change = { ...change, revision: 2, previousRevision: 1, removed: removed.slice(128) };
  expect(cache.patch()).toBeUndefined();
  expect(cache.counts.compactions).toBe(1);
  visible = [
    {
      passName: 'shape',
      ranges: Array.from({ length: 400 }, (unused, start) => ({ start, count: 1 })).filter(
        ({ start }) => !removed.some((range) => range.start === start),
      ),
    },
  ];
  cache = create();
  const fresh = cache.patch();
  expect(fresh?.entries[0]?.ranges).toHaveLength(131);
  expect(cache.counts.compactions).toBe(0);
  expect(cache.patch()?.entries).toEqual(fresh?.entries);
});

it('copies a provider scratch delta before reading another pass', () => {
  const { input } = fixture();
  const visible = input.passes.map(({ name }) => ({
    passName: name,
    ranges:
      name === 'shape'
        ? [
            { start: 0, count: 10 },
            { start: 11, count: 9 },
          ]
        : [
            { start: 0, count: 11 },
            { start: 12, count: 8 },
          ],
  }));
  const source = { ...input, visible };
  const range = { start: 10, count: 1 };
  const scratch = { source: {}, revision: 0, previousRevision: -1, added: [range], removed: [] };
  let revision = 0;
  const cache = new SegmentWindows(
    planSegmentDraws(source),
    source,
    (name) => {
      scratch.revision = revision;
      scratch.previousRevision = revision - 1;
      range.start = name === 'shape' ? 10 : 11;
      return scratch;
    },
    (rank) => [rank],
  );
  revision = 1;
  const patched = cache.patch();
  const full = planSegmentDraws({
    ...input,
    visible: input.passes.map(({ name }) => ({
      passName: name,
      ranges: [{ start: 0, count: 20 }],
    })),
  });
  expect(patched?.entries).toEqual(full.entries);
  expect(patched?.passMaskByRank).toEqual(full.passMaskByRank);
});
