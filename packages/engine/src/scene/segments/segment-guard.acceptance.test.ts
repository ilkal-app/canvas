import { expect, it } from 'vitest';

import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange, InstanceRange } from '../scene-culler.js';

import { orderErrors, seededRandom, type RandomBoard } from './__fixtures__/random-board.js';
import { planSegmentDraws, type PlannedPass, type SegmentPlanInput } from './segment-plan.js';
import { SegmentWindows } from './segment-windows.js';

const RANKS = 80;

function costFallbacks(cache: SegmentWindows): number {
  return (cache.counts as unknown as Record<string, number>).costFallbacks ?? 0;
}

function rangesOf(slots: ReadonlySet<number>): InstanceRange[] {
  return [...slots].sort((a, b) => a - b).map((start) => ({ start, count: 1 }));
}

function fixture(options?: { isIneligible?: boolean }) {
  const passes: PlannedPass[] = ['shape', 'text'].map((name) => ({
    name,
    owners: {
      rankOfSlot: Int32Array.from(
        { length: options?.isIneligible ? 120 : RANKS },
        (unused, slot) => (slot < RANKS ? slot : -1),
      ),
      recordOfSlot: new Int32Array(options?.isIneligible ? 120 : RANKS),
    },
    ...(options?.isIneligible && name === 'shape'
      ? {
          isHiddenByRank: Uint8Array.from({ length: RANKS }, (unused, rank) =>
            rank >= 40 ? 1 : 0,
          ),
        }
      : {}),
  }));
  const visible: DrawListEntry[] = passes.map(({ name }) => ({
    passName: name,
    ranges: [{ start: 0, count: RANKS }],
  }));
  const input: SegmentPlanInput = {
    passes,
    visible,
    isOccluderByRank: new Uint8Array(RANKS).fill(1),
  };
  const changes = new Map<string, CullRangeChange>(
    passes.map(({ name }) => [
      name,
      { source: {}, revision: 0, previousRevision: -1, added: [], removed: [] },
    ]),
  );
  const cache = new SegmentWindows(
    planSegmentDraws(input),
    input,
    (name) => changes.get(name),
    (rank) => [rank],
    // Small fixtures: the guard applies from 1024 live records by default.
    { minGuardedRecords: 0 },
  );
  const change = (name: string, kind: 'added' | 'removed', ranges: InstanceRange[]): void => {
    const old = changes.get(name);
    if (!old) throw new Error('Missing pass');
    changes.set(name, {
      ...old,
      previousRevision: old.revision,
      revision: old.revision + 1,
      added: kind === 'added' ? ranges : [],
      removed: kind === 'removed' ? ranges : [],
    });
  };
  return { cache, change };
}

it('refuses a quarter of live records before building the interval graph', () => {
  const atThreshold = fixture();
  atThreshold.change('shape', 'removed', [{ start: 0, count: 40 }]);
  expect(atThreshold.cache.patch()).toBeUndefined();
  expect(costFallbacks(atThreshold.cache)).toBe(1);
  expect(atThreshold.cache.counts).toMatchObject({
    graphBuilds: 0,
    windowsBuilt: 0,
    removalBuilds: 0,
  });

  const belowThreshold = fixture();
  belowThreshold.change('shape', 'removed', [{ start: 0, count: 39 }]);
  expect(belowThreshold.cache.patch()).toBeDefined();
  expect(costFallbacks(belowThreshold.cache)).toBe(0);
  expect(belowThreshold.cache.counts.graphBuilds).toBe(1);
});

it('refuses a wide entering delta before building the interval graph', () => {
  const { cache, change } = fixture();
  change('shape', 'added', [{ start: 0, count: 80 }]);
  expect(cache.patch()).toBeUndefined();
  expect(cache.counts).toMatchObject({ wideFallbacks: 1, graphBuilds: 0, windowsBuilt: 0 });
  expect(costFallbacks(cache)).toBe(0);
});

it.each([
  ['free', { start: 80, count: 40 }],
  ['hidden', { start: 40, count: 40 }],
  ['past the ownership table', { start: 120, count: 100 }],
] as const)('does not charge %s slots to the cost guard', (label, range) => {
  const { cache, change } = fixture({ isIneligible: true });
  change('shape', 'removed', [range]);
  expect(cache.patch()).toBeDefined();
  expect(costFallbacks(cache)).toBe(0);
});

it('refuses fresh removal state for half the live records but patches one window less', () => {
  for (const touched of [39, 40]) {
    const { cache, change } = fixture();
    change('shape', 'removed', [{ start: 0, count: 1 }]);
    expect(cache.patch()).toBeDefined();
    const before = cache.counts.removalBuilds;
    expect(before).toBe(1);
    change('shape', 'removed', [{ start: 1, count: touched }]);
    const result = cache.patch();
    if (touched === 40) {
      expect(result).toBeUndefined();
      expect(costFallbacks(cache)).toBe(1);
      expect(cache.counts.removalBuilds).toBe(before);
    } else {
      expect(result).toBeDefined();
      expect(costFallbacks(cache)).toBe(0);
      expect(cache.counts.removalBuilds).toBe(before + touched);
    }
  }
});

function coverage(entries: readonly DrawListEntry[], passes: readonly PlannedPass[]): string[] {
  return entries
    .flatMap(({ passName, page, ranges }) => {
      const owners = passes.find(({ name }) => name === passName)?.owners.rankOfSlot;
      return ranges.flatMap(({ start, count }) =>
        Array.from({ length: count }, (unused, index) => start + index)
          .filter((slot) => (owners?.[slot] ?? -1) >= 0)
          .map((slot) => `${passName}:${String(page)}:${String(slot)}`),
      );
    })
    .sort();
}

function churnBoard(): RandomBoard {
  const names = ['rect', 'shape', 'image', 'path', 'text'];
  const passes: PlannedPass[] = names.map((name) => ({
    name,
    owners: {
      rankOfSlot: Int32Array.from({ length: RANKS }, (unused, rank) => rank),
      recordOfSlot: new Int32Array(RANKS),
    },
  }));
  const boxes = Array.from({ length: RANKS }, (unused, rank) => ({
    minX: rank * 2,
    minY: 0,
    maxX: rank * 2 + 12,
    maxY: 12,
  }));
  return {
    count: RANKS,
    boxes,
    isTextHidden: new Array<boolean>(RANKS).fill(false),
    input: {
      passes,
      visible: [],
      isOccluderByRank: Uint8Array.from({ length: RANKS }, (unused, rank) =>
        rank % 4 === 0 ? 1 : 0,
      ),
    },
  };
}

it('matches fresh coverage and paint order through seeded caller fallback churn', () => {
  for (const seed of [17, 29, 43]) {
    const board = churnBoard();
    const random = seededRandom(seed);
    const { passes } = board.input;
    const shown = new Map(
      passes.map(({ name }) => [
        name,
        new Set(Array.from({ length: RANKS }, (unused, slot) => slot).filter(() => random() < 0.7)),
      ]),
    );
    const input = (): SegmentPlanInput => ({
      ...board.input,
      visible: [...shown].map(([passName, slots]) => ({ passName, ranges: rangesOf(slots) })),
      boundsOfRank: (rank) => board.boxes[rank],
    });
    const changes = new Map<string, CullRangeChange>(
      passes.map(({ name }) => [
        name,
        { source: {}, revision: 0, previousRevision: -1, added: [], removed: [] },
      ]),
    );
    const create = () =>
      new SegmentWindows(
        planSegmentDraws(input()),
        input(),
        (name) => changes.get(name),
        (rank) => [rank],
        { minGuardedRecords: 0 },
      );
    let cache = create();
    for (let frame = 0; frame < 60; frame += 1) {
      for (const pass of passes) {
        const old = changes.get(pass.name);
        const slots = shown.get(pass.name);
        if (!old || !slots) throw new Error('Missing pass');
        const added: InstanceRange[] = [];
        const removed: InstanceRange[] = [];
        for (let slot = 0; slot < RANKS; slot += 1) {
          if (random() >= (frame % 5 === 0 ? 0.32 : 0.025)) continue;
          if (slots.delete(slot)) removed.push({ start: slot, count: 1 });
          else {
            slots.add(slot);
            added.push({ start: slot, count: 1 });
          }
        }
        changes.set(pass.name, {
          ...old,
          previousRevision: old.revision,
          revision: old.revision + 1,
          added,
          removed,
        });
      }
      const patched = cache.patch();
      const reference = planSegmentDraws(input());
      const actual = patched ?? reference;
      if (!patched) cache = create();
      expect(
        coverage(actual.entries, passes),
        `seed ${String(seed)} frame ${String(frame)}`,
      ).toEqual(coverage(reference.entries, passes));
      const allowed = orderErrors(board, reference.entries, board.boxes);
      expect(
        [...orderErrors(board, actual.entries, board.boxes)].filter((error) => !allowed.has(error)),
        `seed ${String(seed)} frame ${String(frame)}`,
      ).toEqual([]);
    }
  }
});
