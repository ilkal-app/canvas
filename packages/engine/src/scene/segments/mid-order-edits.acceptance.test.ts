// Written before the code. CONTRACT: eligible leaf edits splice paint ranks in place; structural edits still walk.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FILLED_RECT_PASS } from '../__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
  zKeyAt,
} from '../__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene-pass.js';

import { CLOSING_PASS } from './__fixtures__/segment-board.js';
import { occludersByRank, ranksByObject } from './closing-ranks.js';
import { EMPTY_ORDER, refreshOrder } from './paint-order-tables.js';
import { paintRanksOfSiblings } from './paint-order.js';
import * as mirrorApi from './z-order-mirror.js';
import { ZOrderMirror } from './z-order-mirror.js';

const MAX_ORDER_EDITS =
  (mirrorApi as unknown as Record<string, number>).MAX_ORDER_EDITS ?? Number.NaN;

const PASSES: readonly ScenePass[] = [FILLED_RECT_PASS, CLOSING_PASS];
const START = [
  frameObject('section', { z: zKeyAt(1), stroke: { color: [0, 0, 0, 1], width: 2 } }),
  shapeObject('first', { parentId: 'section', z: zKeyAt(1) }),
  shapeObject('last', { parentId: 'section', z: zKeyAt(3) }),
  groupObject('group', { parentId: 'section', z: zKeyAt(4) }),
  shapeObject('nested', { parentId: 'group', z: zKeyAt(1) }),
  shapeObject('root', { z: zKeyAt(2) }),
  frameObject('plain-frame', { z: zKeyAt(0) }),
];

function seeded(shouldClearDirty = true): { mirror: ZOrderMirror; document: FakeSceneDocument } {
  const document = new FakeSceneDocument();
  const mirror = new ZOrderMirror();
  document.create(...START);
  mirror.observe(document.takeChanges(), PASSES);
  if (shouldClearDirty) mirror.clearDirty();
  return { mirror, document };
}

function observe(mirror: ZOrderMirror, document: FakeSceneDocument): void {
  mirror.observe(document.takeChanges(), PASSES);
}

function expectEdit(change: (document: FakeSceneDocument) => void, id: string): void {
  const { mirror, document } = seeded();
  change(document);
  observe(mirror, document);
  expect(mirror.isOrderDirty).toBe(false);
  expect(
    (mirror as ZOrderMirror & { readonly editedIds: Set<ObjectId> }).editedIds.has(id as ObjectId),
  ).toBe(true);
  mirror.clearDirty();
  expect((mirror as ZOrderMirror & { readonly editedIds: Set<ObjectId> }).editedIds.size).toBe(0);
}

describe('ZOrderMirror mid-order eligibility', () => {
  it.each([
    ['top child', zKeyAt(5)],
    ['first child', zKeyAt(0)],
    ['between siblings', zKeyAt(2)],
  ])('tracks a new section %s', (label, z) => {
    expectEdit((document) => {
      document.create(shapeObject(label, { parentId: 'section', z }));
    }, label);
  });

  it('tracks a leaf deleted between siblings, reparented in both directions, and restacked out of place', () => {
    expectEdit((document) => {
      document.delete('first');
    }, 'first');
    expectEdit((document) => {
      document.update('root', { parentId: 'section' as ObjectId, z: zKeyAt(2) });
    }, 'root');
    expectEdit((document) => {
      document.update('last', { parentId: null, z: zKeyAt(0) });
    }, 'last');
    expectEdit((document) => {
      document.update('first', { z: zKeyAt(6) });
    }, 'first');
    expectEdit((document) => {
      document.update('nested', { parentId: 'section' as ObjectId, z: zKeyAt(2) });
    }, 'nested');
  });

  it.each([
    [
      'delete non-leaf',
      (document: FakeSceneDocument) => {
        document.delete('group');
      },
    ],
    [
      'move non-leaf',
      (document: FakeSceneDocument) => {
        document.update('group', { parentId: null });
      },
    ],
    [
      'restack non-leaf',
      (document: FakeSceneDocument) => {
        document.update('group', { z: zKeyAt(0) });
      },
    ],
    [
      'closing rank appears',
      (document: FakeSceneDocument) => {
        document.update('plain-frame', { stroke: { color: [0, 0, 0, 1], width: 2 } });
      },
    ],
    [
      'created with closing rank',
      (document: FakeSceneDocument) => {
        document.create(frameObject('outlined', { stroke: { color: [0, 0, 0, 1], width: 2 } }));
      },
    ],
    [
      'missing parent',
      (document: FakeSceneDocument) => {
        document.create(shapeObject('orphan', { parentId: 'missing' }));
      },
    ],
  ])('rebuilds for %s', (label, change) => {
    const { mirror, document } = seeded();
    change(document);
    observe(mirror, document);
    expect(mirror.isOrderDirty, label).toBe(true);
  });

  it('rebuilds when the closing rank disappears', () => {
    const { mirror, document } = seeded();
    document.update('section', { stroke: undefined });
    observe(mirror, document);
    expect(mirror.isOrderDirty).toBe(true);
  });

  it('caps distinct mid-order edits in one refresh', () => {
    const { mirror, document } = seeded();
    expect(Number.isInteger(MAX_ORDER_EDITS)).toBe(true);
    document.create(
      ...Array.from({ length: MAX_ORDER_EDITS + 1 }, (unused, index) =>
        shapeObject(`many-${String(index)}`, { parentId: 'section', z: zKeyAt(100 + index) }),
      ),
    );
    observe(mirror, document);
    expect(mirror.isOrderDirty).toBe(true);
  });
});

describe('refreshOrder mid-order tables', () => {
  it('returns the fresh walk and mutates both rank indexes in place through inserts and deletes under a stroked frame', () => {
    const { mirror, document } = seeded(false);
    const initial = refreshOrder(EMPTY_ORDER, mirror, PASSES);
    expect(initial.change).toBe('rebuilt');
    expect(initial.tables.isFromRoots).toBe(true);
    let tables = initial.tables;
    const ranks = ranksByObject(tables.paintOrder, tables.isClosingRank);
    const own = ranks.rankById;
    const closing = ranks.closingRankById;
    mirror.clearDirty();
    for (const operation of [
      'create-quiet',
      'delete-quiet',
      'create-opaque',
      'delete-opaque',
    ] as const) {
      if (operation === 'create-quiet')
        document.create(shapeObject('middle', { parentId: 'section', z: zKeyAt(2), fill: null }));
      else if (operation === 'create-opaque')
        document.create(shapeObject('middle', { parentId: 'section', z: zKeyAt(2) }));
      else document.delete('middle');
      observe(mirror, document);
      const result = refreshOrder(tables, mirror, PASSES, ranks);
      expect(result.change).toBe('edited');
      tables = result.tables;
      const fresh = paintRanksOfSiblings(mirror.siblings, (id) => {
        const object = mirror.get(id);
        return object !== undefined && mirror.hasClosingRank(object, PASSES);
      });
      expect(tables.paintOrder).toEqual(fresh.ids);
      expect([...tables.isClosingRank]).toEqual([...fresh.isClosingRank]);
      expect([...tables.isOccluderByRank]).toEqual([
        ...occludersByRank(fresh.ids, fresh.isClosingRank, mirror, PASSES),
      ]);
      expect(tables.isOccluderByRank).toHaveLength(tables.paintOrder.length);
      expect(tables.isFromRoots).toBe(true);
      const expected = ranksByObject(fresh.ids, fresh.isClosingRank);
      expect(ranks.rankById).toBe(own);
      expect(ranks.closingRankById).toBe(closing);
      expect(new Map(ranks.rankById)).toEqual(new Map(expected.rankById));
      expect(new Map(ranks.closingRankById)).toEqual(new Map(expected.closingRankById));
      mirror.clearDirty();
    }
  });

  it('rebuilds an eligible edit when the previous order was not walked from roots', () => {
    const { mirror, document } = seeded(false);
    const initial = refreshOrder(EMPTY_ORDER, mirror, PASSES);
    expect(initial.change).toBe('rebuilt');
    expect(initial.tables.isFromRoots).toBe(true);
    const tables = initial.tables;
    mirror.clearDirty();
    document.create(shapeObject('middle', { parentId: 'section', z: zKeyAt(2) }));
    observe(mirror, document);
    expect(mirror.isOrderDirty).toBe(false);
    expect(
      (mirror as ZOrderMirror & { readonly editedIds: Set<ObjectId> }).editedIds.has(
        'middle' as ObjectId,
      ),
    ).toBe(true);
    expect(refreshOrder({ ...tables, isFromRoots: false }, mirror, PASSES).change).toBe('rebuilt');
  });
});
