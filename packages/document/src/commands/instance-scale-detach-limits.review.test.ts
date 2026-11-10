// A review regression: every drawn value beyond a stored limit is clamped and reported.
import { describe, expect, it } from 'vitest';

import {
  BOARD_BOUND,
  findValueLimitIssues,
  validateBoard,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';

const id = (value: string): ObjectId => value as ObjectId;

function object(
  type: string,
  objectId: string,
  parentId: string | null,
  fields: Record<string, unknown>,
): BoardObject {
  return {
    id: id(objectId),
    type,
    parentId: parentId === null ? null : id(parentId),
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ADA.principalId,
    createdAt: 1,
    updatedAt: 1,
    ...fields,
  } as BoardObject;
}

function component(fields: Record<string, unknown> = {}): BoardObject {
  return object('component', 'main', null, {
    width: 200,
    height: 100,
    name: 'Main',
    retired: false,
    ...fields,
  });
}

function instance(): BoardObject {
  return object('instance', 'inst', null, {
    width: 400,
    height: 200,
    mainId: id('main'),
    overrides: {},
    scale: 2,
  });
}

function frame(fields: Record<string, unknown> = {}): BoardObject {
  return object('frame', 'child', 'main', {
    width: 30,
    height: 20,
    name: 'Child',
    clip: false,
    background: null,
    ...fields,
  });
}

function shape(fields: Record<string, unknown> = {}): BoardObject {
  return object('shape', 'child', 'main', {
    width: 20,
    height: 20,
    kind: 'rectangle',
    stroke: null,
    fill: null,
    cornerRadius: 0,
    sides: 4,
    label: null,
    ...fields,
  });
}

function image(): BoardObject {
  return object('image', 'child', 'main', {
    width: 100_000_000,
    height: 100_000_000,
    assetId: 'asset-photo',
    crop: { x: 0, y: 0, width: 0.1, height: 0.1 },
    naturalSize: { width: 1000, height: 1000 },
    opacity: 1,
  });
}

function seeded(objects: readonly BoardObject[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const entry of objects) transaction.setObject(entry);
  });
  return store;
}

function detach(store: YjsDocumentStore) {
  return applyCommand(store, mustFindCommand('detachInstance'), { id: 'inst' }).result as {
    idMap: Record<string, ObjectId>;
    clamped: readonly { objectId: ObjectId; field: string; from: number; to: number }[];
  };
}

const LAYOUT = {
  direction: 'row',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
} as const;

describe('scaled detach values at stored limits', () => {
  it('clamps and reports the detached frame auto-layout gap', () => {
    const store = seeded([component({ autoLayout: { ...LAYOUT, gap: 600_000_000 } }), instance()]);

    const result = detach(store);
    expect(result.clamped).toContainEqual({
      objectId: id('inst'),
      field: 'autoLayout.gap',
      from: 1_200_000_000,
      to: BOARD_BOUND,
    });
    expect(mustGet(store, 'inst')).toMatchObject({ autoLayout: { gap: BOARD_BOUND } });
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('clamps and reports a scaled child frame auto-layout padding', () => {
    const store = seeded([
      component(),
      frame({ autoLayout: { ...LAYOUT, padding: { ...LAYOUT.padding, top: 600_000_000 } } }),
      instance(),
    ]);

    const result = detach(store);
    expect(result.clamped).toContainEqual({
      objectId: result.idMap.child,
      field: 'autoLayout.padding.top',
      from: 1_200_000_000,
      to: BOARD_BOUND,
    });
    expect(mustGet(store, result.idMap.child ?? 'missing')).toMatchObject({
      autoLayout: { padding: { top: BOARD_BOUND } },
    });
    expect(validateBoard(store.read())).toEqual([]);
  });

  it.each(['shape', 'frame'] as const)(
    'clamps and reports a scaled %s corner radius at the board value limit',
    (type) => {
      const child =
        type === 'shape'
          ? shape({ cornerRadius: 600_000_000 })
          : frame({ cornerRadius: [600_000_000, 0, 0, 0] });
      const store = seeded([component(), child, instance()]);

      const result = detach(store);
      expect(result.clamped).toContainEqual({
        objectId: result.idMap.child,
        field: type === 'shape' ? 'cornerRadius' : 'cornerRadius.0',
        from: 1_200_000_000,
        to: BOARD_BOUND,
      });
      expect(findValueLimitIssues(mustGet(store, result.idMap.child ?? 'missing'))).toEqual([]);
      expect(validateBoard(store.read())).toEqual([]);
    },
  );

  it('clamps and reports a scaled image whose source behind its crop passes the value limit', () => {
    const store = seeded([component(), image(), instance()]);

    const result = detach(store);
    const copy = mustGet(store, result.idMap.child ?? 'missing');
    expect(result.clamped.length).toBeGreaterThan(0);
    expect(findValueLimitIssues(copy)).toEqual([]);
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('clamps a scaled shape whose image paint passes the value limit behind its crop', () => {
    const fill = {
      type: 'image',
      assetId: 'asset-photo',
      naturalSize: { width: 1000, height: 1000 },
      fit: 'fill',
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    };
    const store = seeded([
      component(),
      shape({ width: 300_000_000, height: 300_000_000, fill }),
      instance(),
    ]);

    const result = detach(store);
    const copy = mustGet(store, result.idMap.child ?? 'missing');
    expect(result.clamped.map(({ field }) => field)).toEqual(['width', 'height']);
    expect(findValueLimitIssues(copy)).toEqual([]);
    expect(validateBoard(store.read())).toEqual([]);
  });

  it('keeps an image a hair past the limit behind its crop within it after rounding', () => {
    // Doubled, the source behind the crop is BOARD_BOUND × (1 + 1e-12): the shrink must land
    // at or under the bound despite floating-point rounding.
    const side = ((BOARD_BOUND * 0.1) / 2) * (1 + 1e-12);
    const store = seeded([
      component(),
      { ...image(), width: side, height: side } as BoardObject,
      instance(),
    ]);

    const result = detach(store);
    const copy = mustGet(store, result.idMap.child ?? 'missing');
    expect(result.clamped.length).toBe(2);
    expect(findValueLimitIssues(copy)).toEqual([]);
  });
});
