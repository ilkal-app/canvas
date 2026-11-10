import { expect, it } from 'vitest';

import type { CullRangeChange, InstanceRange } from '../scene-culler.js';

import {
  BOARD_PASSES,
  orderErrors,
  seededRandom,
  type RandomBoard,
} from './__fixtures__/random-board.js';
import { planSegmentDraws, type PlannedPass, type SegmentPlanInput } from './segment-plan.js';
import { ownedRecordCount } from './segment-window.js';
import { SegmentWindows } from './segment-windows.js';

const RANKS = 200;

function fixture() {
  const passes: PlannedPass[] = ['shape', 'text'].map((name) => ({
    name,
    owners: {
      rankOfSlot: Int32Array.from(
        { length: name === 'text' ? RANKS + 1 : RANKS },
        (unused, slot) => (slot === RANKS ? 100 : slot),
      ),
      recordOfSlot: new Int32Array(name === 'text' ? RANKS + 1 : RANKS),
    },
  }));
  const shown = new Map(
    passes.map(({ name }) => [
      name,
      new Set<number>(Array.from({ length: RANKS }, (unused, rank) => rank)),
    ]),
  );
  const boxes = Array.from({ length: RANKS }, (unused, rank) => ({
    minX: rank * 2,
    minY: 0,
    maxX: rank * 2 + 10,
    maxY: 10,
  }));
  const input = (): SegmentPlanInput => ({
    passes,
    visible: [...shown].map(([passName, slots]) => ({
      passName,
      ranges: [...slots].sort((a, b) => a - b).map((start) => ({ start, count: 1 })),
    })),
    isOccluderByRank: new Uint8Array(RANKS).fill(1),
    boundsOfRank: (rank) => boxes[rank],
  });
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
  const create = (minGuardedRecords?: number) =>
    new SegmentWindows(
      planSegmentDraws(input()),
      input(),
      (name) => changes.get(name),
      (rank) => [rank],
      minGuardedRecords === undefined ? {} : { minGuardedRecords },
    );
  const change = (name: string, slot: number, kind: 'added' | 'removed'): void => {
    const old = changes.get(name);
    const slots = shown.get(name);
    if (!old || !slots) throw new Error('Missing pass');
    if (kind === 'added') slots.add(slot);
    else slots.delete(slot);
    const range: InstanceRange = { start: slot, count: 1 };
    changes.set(name, {
      ...old,
      previousRevision: old.revision,
      revision: old.revision + 1,
      added: kind === 'added' ? [range] : [],
      removed: kind === 'removed' ? [range] : [],
    });
  };
  return { passes, shown, boxes, input, changes, create, change };
}

function coverage(entries: SegmentPlanInput['visible']): string[] {
  return entries
    .flatMap(({ passName, ranges }) =>
      ranges.flatMap(({ start, count }) =>
        Array.from({ length: count }, (unused, index) => `${passName}:${String(start + index)}`),
      ),
    )
    .sort();
}

function oracleBoard(input: SegmentPlanInput, boxes: RandomBoard['boxes']): RandomBoard {
  const empty = (name: string): PlannedPass => ({
    name,
    owners: {
      rankOfSlot: new Int32Array(),
      recordOfSlot: new Int32Array(),
    },
  });
  return {
    count: RANKS,
    boxes,
    isTextHidden: new Array<boolean>(RANKS).fill(false),
    input: {
      ...input,
      passes: BOARD_PASSES.map(
        (name) => input.passes.find((pass) => pass.name === name) ?? empty(name),
      ),
    },
  };
}

it('builds at most five local tables for one entry in a 200-window plan', () => {
  const board = fixture();
  const initial = planSegmentDraws(board.input());
  expect(new Set(initial.segmentOfRank).size).toBe(RANKS);
  const cache = board.create();
  board.change('text', RANKS, 'added');
  const patched = cache.patch();
  expect(patched).toBeDefined();
  expect(cache.counts.graphBuilds).toBe(1);
  expect(cache.counts.windowsBuilt).toBeLessThanOrEqual(5);
  expect(coverage(patched?.entries ?? [])).toEqual(
    coverage(planSegmentDraws(board.input()).entries),
  );
});

it('builds only the removed record’s local table on a removal-only delta', () => {
  const board = fixture();
  const cache = board.create();
  board.change('shape', 75, 'removed');
  const patched = cache.patch();
  expect(patched).toBeDefined();
  expect(cache.counts.windowsBuilt).toBeLessThanOrEqual(1);
  expect(coverage(patched?.entries ?? [])).toEqual(
    coverage(planSegmentDraws(board.input()).entries),
  );
});

it('keeps eager live-total guard refusals exact without building local tables', () => {
  const cost = fixture();
  const costLive = ownedRecordCount(planSegmentDraws(cost.input()), cost.input(), 0, RANKS);
  expect(costLive).toBe(400);
  const costCache = cost.create(0);
  const oldCost = cost.changes.get('shape');
  if (!oldCost) throw new Error('Missing shape cursor');
  cost.changes.set('shape', {
    ...oldCost,
    previousRevision: 0,
    revision: 1,
    added: [],
    removed: [{ start: 0, count: costLive / 4 }],
  });
  expect(costCache.patch()).toBeUndefined();
  expect(costCache.counts).toMatchObject({
    graphBuilds: 0,
    windowsBuilt: 0,
    wideFallbacks: 0,
    costFallbacks: 1,
    compactions: 0,
  });

  const wide = fixture();
  wide.shown.get('text')?.clear();
  const wideLive = ownedRecordCount(planSegmentDraws(wide.input()), wide.input(), 0, RANKS);
  expect(wideLive).toBe(200);
  const wideCache = wide.create(0);
  const oldWide = wide.changes.get('text');
  if (!oldWide) throw new Error('Missing text cursor');
  wide.changes.set('text', {
    ...oldWide,
    previousRevision: 0,
    revision: 1,
    added: [{ start: 0, count: wideLive }],
    removed: [],
  });
  expect(wideCache.patch()).toBeUndefined();
  expect(wideCache.counts).toMatchObject({
    graphBuilds: 0,
    windowsBuilt: 0,
    wideFallbacks: 1,
    costFallbacks: 0,
    compactions: 0,
  });
});

it('keeps coverage, order and guard decisions exact over 200 seeded deltas', () => {
  const board = fixture();
  const random = seededRandom(581);
  let cache = board.create();
  let patches = 0;
  let refusals = 0;
  for (let step = 0; step < 200; step += 1) {
    const name = random() < 0.5 ? 'shape' : 'text';
    const slot = Math.floor(random() * RANKS);
    const kind = board.shown.get(name)?.has(slot) ? 'removed' : 'added';
    const before = planSegmentDraws(board.input());
    const live = ownedRecordCount(before, board.input(), 0, RANKS);
    board.change(name, slot, kind);
    const patched = cache.patch();
    const reference = planSegmentDraws(board.input());
    const counts = cache.counts;
    // The eager guard sees one changed owned record against the exact live total.
    expect(live).toBeGreaterThan(4);
    expect(counts.wideFallbacks).toBe(0);
    expect(counts.costFallbacks).toBe(0);
    expect(counts.compactions).toBe(0);
    if (!patched) {
      refusals += 1;
      cache = board.create();
      continue;
    }
    patches += 1;
    expect(coverage(patched.entries)).toEqual(coverage(reference.entries));
    const oracle = oracleBoard(board.input(), board.boxes);
    const allowed = orderErrors(oracle, reference.entries, board.boxes);
    expect(
      [...orderErrors(oracle, patched.entries, board.boxes)].filter((error) => !allowed.has(error)),
    ).toEqual([]);
  }
  expect(patches).toBe(200);
  expect(refusals).toBe(0);
});
