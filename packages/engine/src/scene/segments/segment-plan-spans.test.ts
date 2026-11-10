import { expect, it } from 'vitest';

import type { WorldBounds } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';

import { planPerSlot } from './__fixtures__/per-slot-segment-plan.js';
import { seededRandom } from './__fixtures__/random-board.js';
import { planSegmentDraws, type PlannedPass, type SegmentPlanInput } from './segment-plan.js';

/** The passes of a random board: the second is paged like text, the third like images. */
const PASS_NAMES = ['shape', 'text', 'image'] as const;

/**
 * A random board whose objects own several records in a pass, as text does (a record a glyph):
 * mostly in consecutive slots in record order, the way a board built by appending stores them,
 * sometimes reversed or scattered, with free slots between, pages that change inside an object's
 * records, hidden objects, ranges that cut through an object, and boxes for some planners.
 *
 * @param seed - The seed.
 * @returns The planner's input.
 */
function multiRecordBoard(seed: number): SegmentPlanInput {
  const random = seededRandom(seed);
  const pick = (below: number): number => Math.floor(random() * below);
  const count = 1 + pick(40);
  const passes: PlannedPass[] = PASS_NAMES.map((name, passIndex) => {
    const ranks: number[] = [];
    const records: number[] = [];
    for (let rank = 0; rank < count; rank += 1) {
      if (random() < 0.3) continue;
      const length = passIndex === 1 ? 1 + pick(12) : 1 + pick(3);
      const order = Array.from({ length }, (unused, record) => record);
      if (random() < 0.15) order.reverse();
      for (const record of order) {
        if (random() < 0.1) {
          ranks.push(-1);
          records.push(0);
        }
        ranks.push(rank);
        records.push(record);
      }
    }
    // Some objects re-slotted out of paint order: swap a few slots.
    for (let swap = pick(3); swap > 0 && ranks.length > 1; swap -= 1) {
      const [a, b] = [pick(ranks.length), pick(ranks.length)];
      [ranks[a], ranks[b]] = [ranks[b] ?? -1, ranks[a] ?? -1];
      [records[a], records[b]] = [records[b] ?? 0, records[a] ?? 0];
    }
    const owners = { rankOfSlot: Int32Array.from(ranks), recordOfSlot: Int32Array.from(records) };
    const isHidden = random() < 0.5;
    return {
      name,
      owners,
      ...(passIndex === 0
        ? {}
        : {
            // A page table one slot short at times: slots past it read as page 0.
            pageOfSlot: Int32Array.from({ length: Math.max(0, ranks.length - pick(2)) }, () =>
              random() < 0.8 ? 0 : 1 + pick(2),
            ),
            isPaintOrderedAcrossPages: passIndex === 2,
          }),
      ...(isHidden
        ? { isHiddenByRank: Uint8Array.from({ length: count }, () => (random() < 0.2 ? 1 : 0)) }
        : {}),
    };
  });
  const visible: DrawListEntry[] = passes.map(({ name, owners }) => {
    const length = owners.rankOfSlot.length;
    const ranges = [];
    for (let start = 0; start < length + 2;) {
      const span = 1 + pick(8);
      if (random() < 0.7) ranges.push({ start, count: span });
      start += span + (random() < 0.5 ? 0 : 1 + pick(3));
    }
    return { passName: name, ranges };
  });
  const boxes = Array.from({ length: count }, (): WorldBounds | undefined => {
    if (random() < 0.1) return undefined;
    const [x, y] = [pick(200), pick(200)];
    return { minX: x, minY: y, maxX: x + 1 + pick(60), maxY: y + 1 + pick(60) };
  });
  return {
    passes,
    isOccluderByRank: Uint8Array.from({ length: count }, () => (random() < 0.3 ? 1 : 0)),
    visible,
    ...(random() < 0.6 ? { boundsOfRank: (rank: number) => boxes[rank] } : {}),
  };
}

it('plans exactly what the per-slot planner did, for objects of many records in any slot order', () => {
  let multiSlotRanges = 0;
  for (let seed = 1; seed <= 2000; seed += 1) {
    const input = multiRecordBoard(seed);
    const expected = planPerSlot(input);
    const plan = planSegmentDraws(input);
    expect(plan.entries, `seed ${String(seed)}`).toEqual(expected.entries);
    expect(plan.passMaskByRank, `seed ${String(seed)}`).toEqual(expected.passMaskByRank);
    expect(plan.segmentOfRank, `seed ${String(seed)}`).toEqual(expected.segmentOfRank);
    expect(plan.pageSpans, `seed ${String(seed)}`).toEqual(expected.pageSpans);
    multiSlotRanges += plan.entries
      .flatMap(({ ranges }) => ranges)
      .filter(({ count }) => count > 1).length;
  }
  // The boards exercise ranges of many records, not only single slots.
  expect(multiSlotRanges).toBeGreaterThan(1000);
});
