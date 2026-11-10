import { expect, it } from 'vitest';

import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange } from '../scene-culler.js';

import { orderErrors, randomBoard, seededRandom } from './__fixtures__/random-board.js';
import { planSegmentDraws, type PlannedPass } from './segment-plan.js';
import { SegmentRemovals } from './segment-removals.js';
import { subtractRanges } from './subtract-ranges.js';

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

it('matches the pure planner through removal sequences on 300 mixed, paged, shuffled boards', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const board = randomBoard(seed);
    const random = seededRandom(seed + 500);
    const { passes } = board.input;
    let visible = board.input.visible;
    const changes = new Map<string, CullRangeChange>(
      passes.map(({ name }) => [
        name,
        {
          source: {},
          revision: 1,
          previousRevision: 0,
          added: [],
          removed: [],
        },
      ]),
    );
    const full = () =>
      planSegmentDraws({ ...board.input, visible, boundsOfRank: (rank) => board.boxes[rank] });
    const removals = new SegmentRemovals(
      full(),
      passes,
      (name) => changes.get(name),
      (rank, name) => {
        const owners = passes.find((pass) => pass.name === name)?.owners.rankOfSlot ?? [];
        return Array.from(owners, (owner, slot) => (owner === rank ? slot : -1)).filter(
          (slot) => slot >= 0,
        );
      },
    );
    for (let step = 0; step < 8; step += 1) {
      visible = visible.map((entry) => {
        const removed = entry.ranges.flatMap(({ start, count }) =>
          Array.from({ length: count }, (unused, index) => ({
            start: start + index,
            count: 1,
          })).filter(() => random() < 0.25),
        );
        const old = changes.get(entry.passName);
        if (!old) throw new Error('Missing change');
        changes.set(entry.passName, {
          ...old,
          previousRevision: old.revision,
          revision: old.revision + 1,
          removed,
        });
        return { ...entry, ranges: subtractRanges(entry.ranges, removed) };
      });
      const patched = removals.patch();
      const reference = full();
      expect(patched, `seed ${String(seed)} step ${String(step)}`).toBeDefined();
      if (!patched) throw new Error('Patch refused');
      expect(coverage(patched.entries, passes)).toEqual(coverage(reference.entries, passes));
      expect(patched.passMaskByRank).toEqual(reference.passMaskByRank);
      for (const span of patched.pageSpans) {
        const other = reference.pageSpans.find(({ passIndex }) => passIndex === span.passIndex);
        expect(span.minPageByRank).toEqual(
          other?.minPageByRank ?? new Int32Array(board.count).fill(2 ** 31 - 1),
        );
        expect(span.maxPageByRank).toEqual(
          other?.maxPageByRank ?? new Int32Array(board.count).fill(-1),
        );
      }
      const referenceErrors = orderErrors(board, reference.entries, board.boxes);
      expect(
        [...orderErrors(board, patched.entries, board.boxes)].filter(
          (error) => !referenceErrors.has(error),
        ),
      ).toEqual([]);
    }
  }
});

it.each(['source', 'skipped', 'addition', 'missing'] as const)(
  'refuses %s changes before mutating any pass',
  (kind) => {
    const board = randomBoard(42);
    const changes = new Map<string, CullRangeChange>(
      board.input.passes.map(({ name }) => [
        name,
        {
          source: {},
          revision: 1,
          previousRevision: 0,
          added: [],
          removed: [],
        },
      ]),
    );
    const plan = planSegmentDraws(board.input);
    const before = structuredClone(plan);
    const removals = new SegmentRemovals(
      plan,
      board.input.passes,
      (name) => changes.get(name),
      () => [],
    );
    for (const [name, old] of changes) {
      changes.set(name, {
        ...old,
        revision: 2,
        previousRevision: 1,
        removed: [{ start: 0, count: 100 }],
      });
    }
    const last = board.input.passes.at(-1)?.name ?? '';
    const old = changes.get(last);
    if (!old) throw new Error('Missing pass');
    if (kind === 'missing') changes.delete(last);
    else
      changes.set(last, {
        ...old,
        source: kind === 'source' ? {} : old.source,
        revision: kind === 'skipped' ? 3 : old.revision,
        added: kind === 'addition' ? [{ start: 0, count: 1 }] : [],
      });
    expect(removals.patch()).toBeUndefined();
    expect(plan).toEqual(before);
  },
);

it('copies a reused delta record before querying the next pass and keeps cursor snapshots', () => {
  const passes: PlannedPass[] = ['a', 'b'].map((name) => ({
    name,
    owners: { rankOfSlot: Int32Array.of(0, 1, 2), recordOfSlot: Int32Array.of(0, 0, 0) },
  }));
  const visible = passes.map(({ name }) => ({ passName: name, ranges: [{ start: 0, count: 3 }] }));
  const plan = planSegmentDraws({ passes, visible, isOccluderByRank: new Uint8Array(3) });
  let revision = 1;
  const range = { start: 0, count: 1 };
  const scratch = { source: {}, revision: 1, previousRevision: 0, added: [], removed: [range] };
  const removals = new SegmentRemovals(
    plan,
    passes,
    (name) => {
      scratch.revision = revision;
      scratch.previousRevision = revision - 1;
      range.start = name === 'a' ? 0 : 2;
      return scratch;
    },
    () => [],
  );
  revision = 2;
  const patched = removals.patch();
  expect(patched && coverage(patched.entries, passes)).toEqual([
    'a:undefined:1',
    'a:undefined:2',
    'b:undefined:0',
    'b:undefined:1',
  ]);
  expect(patched?.passMaskByRank).toEqual(Int32Array.of(2, 3, 1));
});

it('ignores free bridge cuts and drops empty entries without mutating prior draw output', () => {
  const pass: PlannedPass = {
    name: 'a',
    owners: {
      rankOfSlot: Int32Array.of(0, -1, 1),
      recordOfSlot: Int32Array.of(0, -1, 0),
    },
  };
  const plan = planSegmentDraws({
    passes: [pass],
    isOccluderByRank: new Uint8Array(2),
    visible: [{ passName: 'a', ranges: [{ start: 0, count: 3 }] }],
  });
  const before = structuredClone(plan.entries);
  let change: CullRangeChange = {
    source: {},
    revision: 1,
    previousRevision: 0,
    added: [],
    removed: [],
  };
  const removals = new SegmentRemovals(
    plan,
    [pass],
    () => change,
    () => [],
  );
  change = { ...change, revision: 2, previousRevision: 1, removed: [{ start: 1, count: 1 }] };
  expect(removals.patch()?.entries).toEqual(before);
  change = { ...change, revision: 3, previousRevision: 2, removed: [{ start: 0, count: 1 }] };
  const partial = removals.patch();
  const partialBefore = structuredClone(partial?.entries);
  expect(partial && coverage(partial.entries, [pass])).toEqual(['a:undefined:2']);
  change = { ...change, revision: 4, previousRevision: 3, removed: [{ start: 2, count: 1 }] };
  expect(removals.patch()).toMatchObject({ entries: [], segmentCount: 0 });
  expect(plan.entries).toEqual(before);
  expect(partial?.entries).toEqual(partialBefore);
});
