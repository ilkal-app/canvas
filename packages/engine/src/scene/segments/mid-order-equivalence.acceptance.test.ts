// Written before the code. CONTRACT: seeded mixed edits keep every cached table and drawn record equal to a fresh stage after every frame.
import { expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { frameObject, groupObject, shapeObject, zKeyAt } from '../__fixtures__/scene-objects.js';

import {
  board,
  currentObjects,
  draw,
  freshDraw,
  install,
  type Board,
} from './__fixtures__/segment-board.js';
import { ranksByObject } from './closing-ranks.js';
import { hiddenTablesOf } from './planned-passes.js';
import type { PlannedPass } from './segment-plan.js';
import { slotOwnersOf } from './slot-owners.js';

const SEED = 0x674cafe;
function randomSource(): (limit: number) => number {
  let seed = SEED;
  return (limit) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % limit;
  };
}

function hiddenRanks(table: Uint8Array | undefined): number[] {
  return table ? [...table.keys()].filter((rank) => table[rank] === 1) : [];
}

interface AcceptanceTables {
  readonly paintOrder: readonly ObjectId[];
  readonly isClosingRank: Uint8Array;
  readonly isOccluderByRank: Uint8Array;
  readonly rankById: ReadonlyMap<ObjectId, number>;
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
  readonly hiddenByRank: readonly (Uint8Array | undefined)[];
  readonly slotOwners: readonly PlannedPass[];
}

function tablesOf(boardValue: Board): AcceptanceTables {
  return (
    boardValue.segments as typeof boardValue.segments & { tables(): AcceptanceTables }
  ).tables();
}

function orderEdits(boardValue: Board): number {
  return (
    boardValue.segments.counts as typeof boardValue.segments.counts & {
      readonly orderEdits: number;
    }
  ).orderEdits;
}

function expectTables(actual: Board, fresh: Board, label: string): void {
  const tables = tablesOf(actual);
  const reference = tablesOf(fresh);
  expect(tables.paintOrder, label).toEqual(reference.paintOrder);
  expect([...tables.isClosingRank], label).toEqual([...reference.isClosingRank]);
  expect([...tables.isOccluderByRank], label).toEqual([...reference.isOccluderByRank]);
  const ranks = ranksByObject(reference.paintOrder, reference.isClosingRank);
  expect(new Map(tables.rankById), label).toEqual(new Map(ranks.rankById));
  expect(new Map(tables.closingRankById), label).toEqual(new Map(ranks.closingRankById));
  const scene = actual.renderer.scene;
  const hidden = hiddenTablesOf(scene, reference.paintOrder.length, ranks);
  tables.hiddenByRank.forEach((table, index) => {
    expect(hiddenRanks(table), `${label} hidden pass ${String(index)}`).toEqual(
      hiddenRanks(hidden[index]),
    );
  });
  const owners = slotOwnersOf(scene, ranks.rankById, ranks.closingRankById);
  tables.slotOwners.forEach((pass, index) => {
    const expected = owners[index];
    if (expected === undefined) throw new Error(`Missing pass ${String(index)}`);
    expect(pass.name, label).toBe(expected.name);
    const count = scene.instanceBufferOf(pass.name).recordCount;
    expect([...pass.owners.rankOfSlot.subarray(0, count)], label).toEqual([
      ...expected.owners.rankOfSlot,
    ]);
    expect([...pass.owners.recordOfSlot.subarray(0, count)], label).toEqual([
      ...expected.owners.recordOfSlot,
    ]);
    expect(
      [...pass.owners.rankOfSlot.subarray(count)].every((rank) => rank === -1),
      label,
    ).toBe(true);
  });
}

// Every frame builds a fresh reference stage (a new renderer loading ~300 objects) and
// compares the draw order and the order's tables and rank maps with it (hidden tables and slot
// owners are recomputed from the incremental stage's scene), so this test's time is 500 such
// stages, not a unit test's. Measured: 1.5 s on a quiet M1 Max, 6.6–9.5 s on one under load
// (average ~430–460), 11.4 s on a CI unit shard (pr.yml 39961974348); the timeout is about five
// times the slowest.
const EQUIVALENCE_TIMEOUT_MS = 60_000;

it(
  'matches a fresh stage over 500 seeded frames of nested and stroked sections, including structural rebuilds',
  () => {
    const random = randomSource();
    const test = board();
    const ids = new Set<string>();
    const objects: BoardObject[] = [];
    for (let root = 0; root < 60; root += 1) {
      const id = `f-${String(root)}`;
      ids.add(id);
      if (root % 3 === 0) {
        objects.push(
          frameObject(id, {
            z: zKeyAt(root),
            stroke: root % 2 === 0 ? { color: [0, 0, 0, 1], width: 2 } : undefined,
          }),
        );
        const count = root % 5 === 0 ? 40 : root % 7;
        for (let child = 0; child < count; child += 1) {
          const childId = `${id}-c-${String(child)}`;
          ids.add(childId);
          objects.push(
            shapeObject(childId, {
              parentId: id,
              z: zKeyAt(child),
              fill: child % 2 === 0 ? null : [1, 0, 0, 1],
            }),
          );
        }
      } else objects.push(shapeObject(id, { z: zKeyAt(root) }));
    }
    ids.add('nested-group');
    objects.push(groupObject('nested-group', { parentId: 'f-0', z: zKeyAt(50) }));
    ids.add('nested-leaf');
    objects.push(shapeObject('nested-leaf', { parentId: 'nested-group' }));
    install(test, objects);
    let next = 0;
    let editedFrames = 0;
    let rebuiltFrames = 0;
    for (let frame = 0; frame < 500; frame += 1) {
      const before = { ...test.segments.counts };
      const isStructural = frame % 9 === 0;
      const operations = 1 + random(4);
      for (let operation = 0; operation < operations; operation += 1) {
        const leaves = [...ids].filter((id) => {
          const object = test.document.get(id as ObjectId);
          return object?.type === 'shape';
        });
        const id = leaves[random(leaves.length)];
        const parent = random(4) === 0 ? null : `f-${String(3 * random(20))}`;
        const kind = random(4);
        if (kind === 0 || id === undefined) {
          const created = `new-${String(next++)}`;
          ids.add(created);
          test.document.create(
            shapeObject(created, {
              parentId: parent,
              z: zKeyAt(random(80)),
              fill: random(2) === 0 ? null : [1, 0, 0, 1],
            }),
          );
        } else if (kind === 1 && leaves.length > 50) {
          test.document.delete(id);
          ids.delete(id);
        } else if (kind === 2)
          test.document.update(id, { parentId: parent as ObjectId | null, z: zKeyAt(random(80)) });
        else test.document.update(id, { z: zKeyAt(random(80)) });
      }
      if (isStructural) {
        const id = `f-${String(6 * random(10))}`;
        const current = test.document.get(id as ObjectId);
        if (current?.type === 'frame')
          test.document.update(id, {
            stroke: current.stroke ? undefined : { color: [0, 0, 0, 1], width: 2 },
          });
      }
      test.renderer.enqueue(test.document.takeChanges());
      const label = `seed ${String(SEED)} frame ${String(frame)}`;
      const drawn = draw(test);
      const current = currentObjects(test.document, ids);
      const fresh = board();
      const expectedDraw = install(fresh, current);
      expect(drawn, label).toEqual(expectedDraw);
      expectTables(test, fresh, label);
      const after = test.segments.counts;
      if (orderEdits(test) > (before as typeof before & { orderEdits: number }).orderEdits)
        editedFrames += 1;
      if (after.orderBuilds > before.orderBuilds) rebuiltFrames += 1;
      if (
        !isStructural &&
        orderEdits(test) > (before as typeof before & { orderEdits: number }).orderEdits
      ) {
        expect(after.orderBuilds, label).toBe(before.orderBuilds);
        expect(after.slotBuilds, label).toBe(before.slotBuilds);
      }
    }
    expect(editedFrames, `seed ${String(SEED)}`).toBeGreaterThanOrEqual(50);
    expect(rebuiltFrames, `seed ${String(SEED)}`).toBeGreaterThanOrEqual(50);
    expect(freshDraw(currentObjects(test.document, ids))).toEqual(draw(test));
  },
  EQUIVALENCE_TIMEOUT_MS,
);
