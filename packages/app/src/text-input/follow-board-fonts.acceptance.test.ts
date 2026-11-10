// Acceptance (Claude): only the families a board actually uses are requested, never the
// whole library; a family is requested once however many objects use it; labels of shapes and
// connectors count as text; a script present in the text requests its coverage family; objects
// created or restyled later are followed; stopping the follower stops the requests.
import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type {
  BoardObject,
  ConnectorObject,
  ObjectId,
  PrincipalId,
  ShapeObject,
  StyleRun,
  TextObject,
} from '@canvas/schema';

import { followBoardFonts } from './follow-board-fonts.js';
import { FONT_FAMILIES } from './font-catalogue.js';
import type { CoverageNeed } from './script-coverage.js';

const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/**
 * One run over the whole text in a family.
 *
 * @param text - The characters.
 * @param fontFamily - The family.
 * @param weight - Regular or bold.
 * @returns The runs.
 */
function runsOf(text: string, fontFamily: string, weight: 400 | 700 = 400): StyleRun[] {
  return [
    {
      length: text.length,
      style: { fontFamily, fontSize: 24, color: [0, 0, 0, 1], weight, italic: false },
    },
  ];
}

const SHARED = {
  parentId: null,
  rotation: 0,
  locked: false,
  createdBy: ADA.principalId,
  createdAt: 1,
  updatedAt: 1,
} as const;

/**
 * A text object set in a family.
 *
 * @param id - Its id.
 * @param text - Its characters.
 * @param family - Its family.
 * @returns The object.
 */
function text(id: string, text: string, family: string): TextObject {
  return {
    ...SHARED,
    id: id as ObjectId,
    type: 'text',
    x: 0,
    y: 0,
    z: 'a0',
    width: 200,
    height: 30,
    text,
    runs: runsOf(text, family),
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
}

/**
 * A rectangle with a label in a family.
 *
 * @param id - Its id.
 * @param family - The label's family.
 * @returns The shape.
 */
function labelledShape(id: string, family: string): ShapeObject {
  return {
    ...SHARED,
    id: id as ObjectId,
    type: 'shape',
    kind: 'rectangle',
    x: 300,
    y: 0,
    z: 'a1',
    width: 100,
    height: 50,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: { text: 'Label', runs: runsOf('Label', family) },
  };
}

/**
 * A connector between two objects with a label in a family.
 *
 * @param id - Its id.
 * @param from - Its start object.
 * @param to - Its end object.
 * @param family - The label's family.
 * @returns The connector.
 */
function labelledConnector(id: string, from: string, to: string, family: string): ConnectorObject {
  return {
    ...SHARED,
    id: id as ObjectId,
    type: 'connector',
    x: 0,
    y: 0,
    z: 'a2',
    from: { kind: 'object', objectId: from as ObjectId, anchor: null },
    to: { kind: 'object', objectId: to as ObjectId, anchor: null },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: { text: 'Link', runs: runsOf('Link', family) },
  };
}

/**
 * A store holding the objects.
 *
 * @param objects - Parents before children.
 * @returns The store.
 */
function storeOf(objects: readonly BoardObject[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return store;
}

describe('following a board’s fonts', () => {
  it('requests only the families on the board, once each, and none of the unused library', () => {
    const store = storeOf([
      text('t1', 'Default', 'Liberation Sans'),
      text('t2', 'Serif', 'Lora'),
      text('t3', 'Serif again', 'Lora'),
      labelledShape('s1', 'Caveat'),
      labelledConnector('c1', 's1', 't1', 'Oswald'),
    ]);
    const ensure = vi.fn<(family: string) => Promise<boolean>>(() => Promise.resolve(true));
    const stop = followBoardFonts(store, ensure);
    const requested = ensure.mock.calls.map(([family]) => family);
    expect(requested.sort()).toEqual(['Caveat', 'Liberation Sans', 'Lora', 'Oswald']);
    expect(new Set(requested).size).toBe(requested.length);
    expect(FONT_FAMILIES.length).toBeGreaterThan(requested.length);
    stop();
    store.destroy();
  });

  it('requests a script’s coverage family for text in that script, and nothing for Latin', () => {
    const store = storeOf([
      text('t1', 'Hello', 'Inter'),
      text('t2', 'שלום', 'Inter'),
      labelledShape('s1', 'Inter'),
    ]);
    const ensure = vi.fn<(family: string) => Promise<boolean>>(() => Promise.resolve(true));
    // Coverage families go to the coverage loader, which takes a CJK family by slice.
    const ensureCoverage = vi.fn<(need: CoverageNeed) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const stop = followBoardFonts(store, ensure, ensureCoverage);
    expect(ensure.mock.calls.map(([family]) => family)).toEqual(['Inter']);
    expect(ensureCoverage.mock.calls.map(([need]) => need)).toEqual([
      { family: 'Noto Sans Hebrew' },
    ]);
    stop();
    store.destroy();
  });

  it('asks for a CJK face\u2019s bold slices when its text turns bold', () => {
    const store = storeOf([text('t1', '\u4E2D\u6587', 'Inter')]);
    const ensureCoverage = vi.fn<(need: CoverageNeed) => Promise<boolean>>(() =>
      Promise.resolve(true),
    );
    const stop = followBoardFonts(store, () => Promise.resolve(true), ensureCoverage);
    expect(ensureCoverage.mock.calls.map(([need]) => need.weights)).toEqual([[400]]);
    store.transact(ADA, (transaction) => {
      transaction.formatText('t1' as ObjectId, 0, 2, { weight: 700 });
    });
    expect(ensureCoverage.mock.calls.map(([need]) => need.weights)).toEqual([[400], [700]]);
    stop();
    store.destroy();
  });

  it('follows objects created or restyled later, and stops when told to', () => {
    const store = storeOf([text('t1', 'Default', 'Liberation Sans')]);
    const ensure = vi.fn<(family: string) => Promise<boolean>>(() => Promise.resolve(true));
    const stop = followBoardFonts(store, ensure);
    ensure.mockClear();

    store.transact(ADA, (transaction) => {
      transaction.setObject(text('t2', 'New', 'JetBrains Mono'));
    });
    expect(ensure.mock.calls.map(([family]) => family)).toEqual(['JetBrains Mono']);

    store.transact(ADA, (transaction) => {
      transaction.formatText('t1' as ObjectId, 0, 'Default'.length, { fontFamily: 'Kalam' });
    });
    expect(ensure.mock.calls.map(([family]) => family)).toEqual(['JetBrains Mono', 'Kalam']);

    // A family already requested is not requested again when another object takes it.
    store.transact(ADA, (transaction) => {
      transaction.setObject(text('t3', 'Also mono', 'JetBrains Mono'));
    });
    expect(ensure).toHaveBeenCalledTimes(2);

    stop();
    store.transact(ADA, (transaction) => {
      transaction.setObject(text('t4', 'After', 'Fira Code'));
    });
    expect(ensure).toHaveBeenCalledTimes(2);
    store.destroy();
  });

  it('writes nothing to the board: following is read-only', () => {
    const store = storeOf([text('t1', 'Words', 'Lora')]);
    const before = structuredClone(store.get('t1' as ObjectId));
    const stop = followBoardFonts(store, () => Promise.resolve(true));
    expect(store.get('t1' as ObjectId)).toEqual(before);
    stop();
    store.destroy();
  });
});
