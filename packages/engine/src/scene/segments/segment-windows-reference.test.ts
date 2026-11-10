import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';
import type { CullRangeChange } from '../scene-culler.js';

import { orderErrors, randomBoard, randomBox, seededRandom } from './__fixtures__/random-board.js';
import { checkMovedObjects } from './segment-moves.js';
import { planSegmentDraws, type PlannedPass } from './segment-plan.js';
import { SegmentWindows } from './segment-windows.js';

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

function meets(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

it('matches full coverage and move safety across additions, removals and recycled segment IDs', () => {
  let repairs = 0;
  let keptMoves = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const board = randomBoard(seed);
    const random = seededRandom(seed + 1700);
    const { passes } = board.input;
    const shown = new Map(
      passes.map((pass) => [
        pass.name,
        new Set(
          Array.from(pass.owners.rankOfSlot, (unused, slot) => slot).filter(() => random() < 0.7),
        ),
      ]),
    );
    const visibility = () =>
      [...shown].map(([passName, slots]) => ({
        passName,
        ranges: [...slots].sort((a, b) => a - b).map((start) => ({ start, count: 1 })),
      }));
    const input = () => ({
      ...board.input,
      visible: visibility(),
      boundsOfRank: (rank: number) => board.boxes[rank],
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
    const create = () =>
      new SegmentWindows(
        planSegmentDraws(input()),
        input(),
        (name) => changes.get(name),
        (rank, name) =>
          Array.from(
            passes.find((pass) => pass.name === name)?.owners.rankOfSlot ?? [],
            (owner, slot) => (owner === rank ? slot : -1),
          ).filter((slot) => slot >= 0),
      );
    let cache = create();
    for (let step = 0; step < 12; step += 1) {
      for (const pass of passes) {
        const old = changes.get(pass.name);
        const slots = shown.get(pass.name);
        if (!old || !slots) throw new Error('Missing pass');
        const added = [];
        const removed = [];
        for (let slot = 0; slot < pass.owners.rankOfSlot.length; slot += 1) {
          if (random() >= 0.08) continue;
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
      const before = cache.counts.repairs;
      const patched = cache.patch();
      const reference = planSegmentDraws(input());
      if (!patched) {
        cache = create();
        continue;
      }
      repairs += cache.counts.repairs - before;
      expect(coverage(patched.entries, passes)).toEqual(coverage(reference.entries, passes));
      expect(patched.passMaskByRank).toEqual(reference.passMaskByRank);
      const unmoved = orderErrors(board, reference.entries, board.boxes);
      expect(
        [...orderErrors(board, patched.entries, board.boxes)].filter(
          (error) => !unmoved.has(error),
        ),
        `unmoved seed ${String(seed)} step ${String(step)}`,
      ).toEqual([]);
      expect(Math.max(...patched.segmentOfRank)).toBeLessThan(board.count);
      for (const span of patched.pageSpans) {
        const other = reference.pageSpans.find(({ passIndex }) => passIndex === span.passIndex);
        expect(span.minPageByRank).toEqual(
          other?.minPageByRank ?? new Int32Array(board.count).fill(2 ** 31 - 1),
        );
        expect(span.maxPageByRank).toEqual(
          other?.maxPageByRank ?? new Int32Array(board.count).fill(-1),
        );
      }
      const rank = Math.floor(random() * board.count);
      const boxes = board.boxes.slice();
      boxes[rank] = randomBox(random);
      const spatial = {
        boundsOf: (id: ObjectId) => boxes[Number(id)],
        searchRect: (rect: WorldBounds) =>
          boxes.flatMap((box, index) =>
            !box || meets(box, rect) ? [String(index) as ObjectId] : [],
          ),
      };
      const verdict = patched.hasSpatialMerges
        ? checkMovedObjects(patched, [String(rank) as ObjectId], Number, spatial, 256)
        : 'kept';
      if (verdict !== 'kept') continue;
      keptMoves += 1;
      const baseline = planSegmentDraws({ ...board.input, visible: visibility() });
      const allowed = orderErrors(board, baseline.entries, boxes);
      expect(
        [...orderErrors(board, patched.entries, boxes)].filter((error) => !allowed.has(error)),
        `seed ${String(seed)} step ${String(step)}`,
      ).toEqual([]);
    }
  }
  expect(repairs).toBeGreaterThan(100);
  expect(keptMoves).toBeGreaterThan(100);
});
