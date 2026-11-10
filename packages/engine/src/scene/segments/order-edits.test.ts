// Edits in the middle of the paint order, unit by unit: the rank index a shift moves,
// the cases `editedOrder` refuses (the order is walked instead), the hidden tables and the slot
// owners moved through a shift, and a stage whose text the level of detail hides, checked
// against a fresh walk after each edit.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { TEXT_LEVEL_OF_DETAIL } from '../../text/scene/text-detail.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from '../__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import { NOTE_PASS, TEXT_PASS, textObject } from './__fixtures__/note-and-text-passes.js';
import { CLOSING_PASS } from './__fixtures__/segment-board.js';
import { ranksByObject } from './closing-ranks.js';
import { editedOrder, type RankShift } from './order-edits.js';
import { EMPTY_ORDER, refreshOrder } from './paint-order-tables.js';
import { hiddenTablesOf, shiftedHiddenTables } from './planned-passes.js';
import { RankIndex } from './rank-index.js';
import { SlotOwnerTable } from './slot-owner-table.js';
import { ZOrderMirror } from './z-order-mirror.js';
import { ZOrderSegments } from './z-order-segments.js';

const id = (value: string) => value as ObjectId;

describe('RankIndex', () => {
  it('reads as a map, reuses a freed handle, grows, and remaps every rank in one pass', () => {
    const index = new RankIndex();
    for (let rank = 0; rank < 40; rank += 1) index.set(id(`o${String(rank)}`), rank);
    expect(index.size).toBe(40);
    expect(index.get(id('o39'))).toBe(39);
    expect(index.delete(id('o3'))).toBe(true);
    expect(index.delete(id('o3'))).toBe(false);
    expect(index.has(id('o3'))).toBe(false);
    expect(index.get(id('o3'))).toBeUndefined();
    index.set(id('new'), 3);
    expect(index.size).toBe(40);
    index.remap(Int32Array.from({ length: 40 }, (unused, rank) => rank * 2));
    expect(index.get(id('new'))).toBe(6);
    expect(index.get(id('o10'))).toBe(20);
    const entries = new Map(index);
    expect(entries.get(id('o39'))).toBe(78);
    expect([...index.keys()]).toHaveLength(40);
    expect([...index.values()].reduce((sum, rank) => sum + rank, 0)).toBe(
      [...index.entries()].reduce((sum, [, rank]) => sum + rank, 0),
    );
    const seen: [ObjectId, number][] = [];
    index.forEach((rank, key, map) => {
      expect(map).toBe(index);
      seen.push([key, rank]);
    });
    expect(new Map(seen)).toEqual(entries);
  });
});

/**
 * A mirror over a board, its first order walked and its dirtiness cleared.
 *
 * @param passes - The passes.
 * @returns The mirror, the document, and the walked tables.
 */
function walked(passes: readonly ScenePass[]) {
  const mirror = new ZOrderMirror();
  const document = new FakeSceneDocument();
  document.create(
    frameObject('section', { z: zKeyAt(0), stroke: { color: [0, 0, 0, 1], width: 2 } }),
    shapeObject('child', { parentId: 'section', z: zKeyAt(0) }),
    shapeObject('root', { z: zKeyAt(1) }),
  );
  mirror.observe(document.takeChanges(), passes);
  const { tables } = refreshOrder(EMPTY_ORDER, mirror, passes);
  mirror.clearDirty();
  return { mirror, document, tables };
}

describe('editedOrder refuses what it cannot place', () => {
  const passes = [FILLED_RECT_PASS, CLOSING_PASS];

  it('refuses an edited object with a closing rank, touching no rank', () => {
    const { mirror, tables } = walked(passes);
    const ranks = ranksByObject(tables.paintOrder, tables.isClosingRank);
    const before = new Map(ranks.rankById);
    mirror.editedIds.add(id('section'));
    expect(editedOrder(tables, mirror, passes, ranks)).toBeUndefined();
    expect(new Map(ranks.rankById)).toEqual(before);
  });

  it('refuses an object placed after one the order does not hold, and the order is walked', () => {
    const { mirror, document, tables } = walked(passes);
    document.create(
      shapeObject('unseen', { z: `${zKeyAt(0)}a` }),
      shapeObject('above', { z: `${zKeyAt(0)}b` }),
    );
    mirror.observe(document.takeChanges(), passes);
    // Only the upper one recorded: what it paints after is in neither the order nor the edit.
    mirror.editedIds.delete(id('unseen'));
    const ranks = ranksByObject(tables.paintOrder, tables.isClosingRank);
    expect(editedOrder(tables, mirror, passes, ranks)).toBeUndefined();
    const refreshed = refreshOrder(tables, mirror, passes, ranks);
    expect(refreshed.change).toBe('rebuilt');
    expect(refreshed.tables.paintOrder).toEqual([
      'section',
      'child',
      'section',
      'unseen',
      'above',
      'root',
    ]);
  });

  it('builds its own rank index when given none', () => {
    const { mirror, document, tables } = walked(passes);
    document.create(shapeObject('second', { parentId: 'section', z: zKeyAt(1) }));
    mirror.observe(document.takeChanges(), passes);
    const { change, tables: next, shift } = refreshOrder(tables, mirror, passes);
    expect(change).toBe('edited');
    expect(next.paintOrder).toEqual(['section', 'child', 'second', 'section', 'root']);
    expect(shift?.inserted).toEqual([['second', 2]]);
    expect([...(shift?.newRanks ?? [])]).toEqual([0, 1, 3, 4]);
  });
});

describe('tables moved through a shift', () => {
  // Old ranks 0..4; rank 1 removed, `new` inserted at new rank 3.
  const shift: RankShift = {
    length: 5,
    newRanks: Int32Array.of(0, -1, 1, 2, 4),
    firstMoved: 1,
    inserted: [[id('new'), 3]],
  };
  const sceneHiding = (hidden: Record<string, readonly string[]>) => ({
    passes: [
      { name: 'own' },
      { name: 'closing', isDrawnAfterDescendants: true },
    ] as unknown as readonly ScenePass[],
    levelOfDetail: {
      hiddenIn: (name: string) => new Set((hidden[name] ?? []) as ObjectId[]),
    } as unknown as Parameters<typeof shiftedHiddenTables>[0]['levelOfDetail'],
  });

  it('moves hidden ranks, drops removed ones and marks a hidden insertion in its own passes only', () => {
    const tables = shiftedHiddenTables(
      sceneHiding({ own: ['new'], closing: ['new'] }),
      [Uint8Array.of(1, 1, 0, 0, 1), Uint8Array.of(0, 0, 1, 0, 0)],
      shift,
    );
    expect(tables?.map((table) => [...(table ?? [])])).toEqual([
      [1, 0, 0, 1, 1],
      [0, 1, 0, 0, 0],
    ]);
  });

  it('keeps a pass that hides nothing, and gives up when an insertion is hidden in one', () => {
    expect(shiftedHiddenTables(sceneHiding({}), [undefined, undefined], shift)).toEqual([
      undefined,
      undefined,
    ]);
    expect(
      shiftedHiddenTables(sceneHiding({ own: ['new'] }), [undefined, undefined], shift),
    ).toBeUndefined();
  });

  it('moves every owned slot, unowning the removed rank’s', () => {
    const slots = new SlotOwnerTable();
    slots.tables = [
      {
        name: 'pass',
        owners: {
          rankOfSlot: Int32Array.of(4, 1, -1, 0, 3),
          recordOfSlot: Int32Array.of(0, 2, 0, 0, 1),
        },
      },
    ];
    slots.remap(shift.newRanks);
    const [pass] = slots.tables;
    expect([...(pass?.owners.rankOfSlot ?? [])]).toEqual([4, -1, -1, 0, 2]);
    expect([...(pass?.owners.recordOfSlot ?? [])]).toEqual([0, 0, 0, 0, 1]);
  });
});

it('keeps the hidden tables equal to a fresh build through edits among hidden text', () => {
  const sizes = new Map<string, number>();
  const textPass: ScenePass = {
    ...TEXT_PASS,
    levelOfDetail: { ...TEXT_LEVEL_OF_DETAIL, sizeOf: (object) => sizes.get(object.id) ?? 1000 },
  };
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [NOTE_PASS, textPass],
    isZOrdered: false,
  });
  const segments = new ZOrderSegments({ compaction: false });
  segments.install(renderer.frame);
  const document = new FakeSceneDocument();
  const far: Camera = {
    x: 0,
    y: 0,
    zoom: 0.1,
    viewportWidthPx: 1000,
    viewportHeightPx: 800,
    dpr: 1,
  };
  document.create(frameObject('section', { z: zKeyAt(0), width: 4000, height: 4000 }));
  for (let index = 0; index < 20; index += 1) {
    const textId = `t${String(index)}`;
    if (index % 2 === 0) sizes.set(textId, 1);
    document.create(
      textObject(textId, { parentId: 'section' as ObjectId, z: zKeyAt(index), x: index * 50 }),
    );
  }
  document.create(textObject('top', { z: zKeyAt(1) }));
  const frame = () => {
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: far });
    const tables = segments.tables();
    const ranks = ranksByObject(tables.paintOrder, tables.isClosingRank);
    const fresh = hiddenTablesOf(renderer.scene, tables.paintOrder.length, ranks);
    const hiddenRanks = (table: Uint8Array | undefined) =>
      [...(table ?? [])].flatMap((bit, rank) => (bit === 1 ? [rank] : []));
    expect(tables.hiddenByRank.map(hiddenRanks)).toEqual(fresh.map(hiddenRanks));
    return tables;
  };
  expect(frame().hiddenByRank.some((table) => table?.includes(1) === true)).toBe(true);
  const before = segments.counts;
  // A shown text inserted among hidden ones, a hidden one deleted, one moved out to the root.
  document.create(textObject('shown', { parentId: 'section' as ObjectId, z: zKeyAt(4), x: 7 }));
  frame();
  document.delete('t6');
  frame();
  document.update('t1', { parentId: null, z: zKeyAt(0) });
  frame();
  expect(segments.counts.orderBuilds).toBe(before.orderBuilds);
  expect(segments.counts.orderEdits).toBe(before.orderEdits + 3);
});
