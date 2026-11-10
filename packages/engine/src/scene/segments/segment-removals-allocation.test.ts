import { expect, it } from 'vitest';

import type { CullRangeChange } from '../scene-culler.js';

import { planSegmentDraws } from './segment-plan.js';
import { SegmentRemovals } from './segment-removals.js';

function fixture() {
  const passes = ['shape', 'text', 'image', 'path'].map((name) => ({
    name,
    owners: { rankOfSlot: Int32Array.of(0, 1), recordOfSlot: new Int32Array(2) },
  }));
  const plan = planSegmentDraws({
    passes,
    visible: [{ passName: 'shape', ranges: [{ start: 0, count: 2 }] }],
    isOccluderByRank: new Uint8Array(2),
  });
  const changes = new Map<string, CullRangeChange>(
    passes.map(({ name }) => [
      name,
      { source: {}, revision: 0, previousRevision: -1, added: [], removed: [] },
    ]),
  );
  const create = () =>
    new SegmentRemovals(
      plan,
      passes,
      (name) => changes.get(name),
      (rank) => [rank],
    );
  return { create, changes };
}

it('allocates rank counts only for passes represented in the retained draw entries', () => {
  const { create } = fixture();
  const original = globalThis.Uint32Array;
  let allocations = 0;
  globalThis.Uint32Array = new Proxy(original, {
    construct(target, [length]) {
      if (typeof length !== 'number') throw new Error('Expected a rank-count length');
      allocations += 1;
      return new target(length);
    },
  });
  try {
    expect(create().liveRecords).toBe(2);
  } finally {
    globalThis.Uint32Array = original;
  }
  expect(allocations).toBe(1);
});

it.each(['added', 'revision', 'source'] as const)(
  'still rejects an absent pass with an unsafe %s delta',
  (kind) => {
    const { create, changes } = fixture();
    const removals = create();
    const old = changes.get('text');
    if (!old) throw new Error('Missing text cursor');
    changes.set('text', {
      ...old,
      source: kind === 'source' ? {} : old.source,
      previousRevision: 0,
      revision: kind === 'revision' ? 2 : 1,
      added: kind === 'added' ? [{ start: 0, count: 1 }] : [],
    });
    expect(removals.patch()).toBeUndefined();
    expect(removals.liveRecords).toBe(2);
  },
);

it('advances harmless removals from absent passes without allocating their tables', () => {
  const { create, changes } = fixture();
  const removals = create();
  const old = changes.get('text');
  if (!old) throw new Error('Missing text cursor');
  changes.set('text', {
    ...old,
    previousRevision: 0,
    revision: 1,
    removed: [{ start: 0, count: 1 }],
  });
  expect(removals.patch()?.entries).toHaveLength(1);
  expect(removals.liveRecords).toBe(2);
});
