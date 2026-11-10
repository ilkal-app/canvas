// Rules 6 and 7: deleting a main detaches every instance in the same undo step, and
// instances may hold instances. Deleting a main together with a main used inside it (one
// selection, or one page) must not be refused `retired-main`: the outer instance's detach would
// otherwise materialise a new instance of the co-deleted inner main. Every instance of every
// deleted main ends as plain objects, nothing disappears, and the board stays valid.
import { describe, expect, it } from 'vitest';

import {
  instanceReferenceProblems,
  validateBoard,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newSticky,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import {
  AGENT_FOR_ADA,
  codesOf,
  expectRefusedBy,
  instancesOf,
  mustFindCommand,
} from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { runCommand } from './run-command.js';

/** The result of `deleteObjects` once mains are retired. */
interface DeleteResult {
  readonly deletedIds: readonly string[];
  readonly retiredIds: readonly string[];
  readonly detachedIds: readonly string[];
}

/** The badge's override colour, set through the card instance on the nested badge's sticky. */
const GREEN = [0.2, 0.9, 0.2, 1];

/**
 * A badge main (one sticky), a card main holding an instance of the badge, an instance of the
 * card at (2000, 0) whose override recolours the nested badge's sticky, and a badge instance at
 * the root.
 *
 * @param store - The store.
 * @param origin - Who seeds everything; Ada by default.
 * @returns The ids.
 */
function seedNested(store: YjsDocumentStore, origin = ADA) {
  const badgeLeaf = seedLeafMain(store, 'main-badge', { x: 1000, y: 1000 }, origin);
  const card = seedMainWithChildren(store, { origin });
  const nested = placeInstance(
    store,
    'main-badge',
    { x: 120, y: 280, parentId: card.mainId, instanceId: 'nested' },
    origin,
  );
  const outer = placeInstance(store, card.mainId, { x: 2000, y: 0, instanceId: 'inst-1' }, origin);
  applyCommand(
    store,
    mustFindCommand('setInstanceOverride'),
    { id: outer, path: `${nested}/${badgeLeaf}`, override: { color: GREEN } },
    origin,
  );
  const badgeInstance = placeInstance(
    store,
    'main-badge',
    { x: 3000, y: 0, instanceId: 'badge-1' },
    origin,
  );
  return { badgeLeaf, cardId: card.mainId, nested, outer, badgeInstance };
}

/**
 * Checks the board holds no instance problem and passes the schema's validation.
 *
 * @param store - The store.
 */
function expectValid(store: YjsDocumentStore): void {
  expect(validateBoard(store.read())).toEqual([]);
  expect([...instanceReferenceProblems(store.read())]).toEqual([]);
}

/**
 * Every stored instance on the board.
 *
 * @param store - The store.
 * @returns The instances.
 */
function storedInstances(store: YjsDocumentStore): BoardObject[] {
  return [...store.read().objects.values()].filter((object) => object.type === 'instance');
}

/**
 * The children of an object, by type.
 *
 * @param store - The store.
 * @param id - The parent.
 * @returns Its children.
 */
function childrenOf(store: YjsDocumentStore, id: string): BoardObject[] {
  return [...store.references.childrenOf(id as ObjectId)].map((child) => mustGet(store, child));
}

describe('deleting a main with a main used inside it', () => {
  for (const order of ['outer first', 'inner first'] as const) {
    it(`detaches every instance, flattening the nested one (${order})`, () => {
      const store = new YjsDocumentStore();
      const { cardId, nested, outer, badgeInstance } = seedNested(store);
      const ids = order === 'outer first' ? [cardId, 'main-badge'] : ['main-badge', cardId];
      const { result } = applyCommand(
        store,
        deleteObjectsCommand,
        { ids },
        ADA,
        testEnvironment(99),
      );
      const { retiredIds, detachedIds, deletedIds } = result as unknown as DeleteResult;
      expect(retiredIds).toEqual(['main-badge', cardId].sort());
      expect([...detachedIds].sort()).toEqual([badgeInstance, nested, outer].sort());
      expect(deletedIds).toEqual([]);
      expect(storedInstances(store)).toEqual([]);
      expect([...instancesOf(store, cardId)]).toEqual([]);
      expect([...instancesOf(store, 'main-badge')]).toEqual([]);
      // The card instance is a frame whose badge is a plain frame holding the recoloured sticky.
      expect(mustGet(store, outer)).toMatchObject({ type: 'frame', name: 'Card' });
      const content = childrenOf(store, outer);
      expect(content.map(({ type }) => type).sort()).toEqual([
        'frame',
        'image',
        'shape',
        'sticky',
        'text',
      ]);
      const badge = content.find(({ type }) => type === 'frame');
      expect(badge).toMatchObject({ name: 'main-badge', x: 20, y: 180, clip: false });
      const badgeContent = childrenOf(store, badge?.id ?? '');
      expect(badgeContent).toHaveLength(1);
      expect(badgeContent[0]).toMatchObject({ type: 'sticky', color: GREEN });
      expect(mustGet(store, nested)).toMatchObject({ type: 'frame', parentId: cardId });
      expect(mustGet(store, badgeInstance)).toMatchObject({ type: 'frame', name: 'main-badge' });
      expectValid(store);
    });
  }

  it('is one undo step, and redo deletes again', () => {
    const store = new YjsDocumentStore();
    const { cardId, outer } = seedNested(store);
    const before = new Map(store.read().objects);
    const history = createHistory(store, ADA.principalId);
    applyCommand(
      store,
      deleteObjectsCommand,
      { ids: [cardId, 'main-badge'] },
      ADA,
      testEnvironment(99),
    );
    const after = new Map(store.read().objects);
    expect(history.undo()).toBe(true);
    expect(new Map(store.read().objects)).toEqual(before);
    expectValid(store);
    expect(history.redo()).toBe(true);
    expect(new Map(store.read().objects)).toEqual(after);
    expect(mustGet(store, outer).type).toBe('frame');
    expectValid(store);
    history.destroy();
  });

  it('flattens three levels deleted together, in either order', () => {
    for (const isReversed of [false, true]) {
      const store = new YjsDocumentStore();
      seedLeafMain(store, 'main-dot', { x: 5000, y: 5000 });
      const { cardId, outer } = seedNested(store);
      placeInstance(store, 'main-dot', { x: 1010, y: 1010, parentId: 'main-badge' });
      const ids = ['main-dot', 'main-badge', cardId];
      if (isReversed) ids.reverse();
      const count = store.read().objects.size;
      applyCommand(store, deleteObjectsCommand, { ids }, ADA, testEnvironment(99));
      expect(storedInstances(store)).toEqual([]);
      const badge = childrenOf(store, outer).find(({ type }) => type === 'frame');
      const dot = childrenOf(store, badge?.id ?? '').find(({ type }) => type === 'frame');
      expect(dot).toMatchObject({ name: 'main-dot' });
      expect(childrenOf(store, dot?.id ?? '').map(({ type }) => type)).toEqual(['sticky']);
      expect(store.read().objects.size).toBeGreaterThan(count);
      expectValid(store);
    }
  });

  it('keeps a nested instance of a surviving main as an instance', () => {
    const store = new YjsDocumentStore();
    seedLeafMain(store, 'main-dot', { x: 5000, y: 5000 });
    const { cardId, outer } = seedNested(store);
    placeInstance(store, 'main-dot', { x: 1010, y: 1010, parentId: 'main-badge' });
    applyCommand(
      store,
      deleteObjectsCommand,
      { ids: ['main-dot', cardId] },
      ADA,
      testEnvironment(99),
    );
    const kept = childrenOf(store, outer).find(({ type }) => type === 'instance');
    expect(kept).toMatchObject({ mainId: 'main-badge' });
    expect(mustGet(store, 'main-badge')).toMatchObject({ retired: false });
    expect([...instancesOf(store, 'main-dot')]).toEqual([]);
    expectValid(store);
  });

  it('splits a large deletion into parts in one undo step', () => {
    const store = new YjsDocumentStore();
    const { cardId } = seedNested(store);
    for (let index = 0; index < 180; index += 1)
      placeInstance(store, cardId, {
        x: 4000 + index * 500,
        y: 0,
        instanceId: `many-${String(index)}`,
      });
    const before = new Map(store.read().objects);
    const history = createHistory(store, ADA.principalId);
    const { result } = applyCommand(
      store,
      deleteObjectsCommand,
      { ids: ['main-badge', cardId] },
      ADA,
      testEnvironment(99),
    );
    expect((result as unknown as DeleteResult).detachedIds.length).toBe(183);
    expect(storedInstances(store)).toEqual([]);
    expect(store.read().objects.size - before.size).toBeGreaterThan(1000);
    expectValid(store);
    expect(history.undo()).toBe(true);
    expect(new Map(store.read().objects)).toEqual(before);
    history.destroy();
  });

  it('lets an agent delete its own mains together, and still refuses foreign ones', () => {
    const own = new YjsDocumentStore();
    const { cardId } = seedNested(own, AGENT_FOR_ADA);
    const outcome = runCommand(
      own,
      AGENT_FOR_ADA,
      deleteObjectsCommand,
      { ids: [cardId, 'main-badge'] },
      testEnvironment(99),
    );
    expect(outcome.status).toBe('applied');
    expect(storedInstances(own)).toEqual([]);
    expectValid(own);
    const foreign = new YjsDocumentStore();
    seedNested(foreign);
    const errors = expectRefusedBy(foreign, AGENT_FOR_ADA, deleteObjectsCommand, {
      ids: ['main-card', 'main-badge'],
    });
    expect(codesOf(errors)).toEqual(['not-own-main']);
  });
});

describe('deletePage holding a main and a main used inside it', () => {
  it('detaches the instance on another page, flattening the nested one, in one undo step', () => {
    const store = new YjsDocumentStore();
    const { outer } = seedNested(store);
    createChild(store, newSticky('loose', null, { x: 0, y: 2000, width: 100, height: 100 }));
    const { pageId } = applyCommand(store, mustFindCommand('addPage'), {}, ADA, testEnvironment(31))
      .result as { pageId: string };
    applyCommand(store, mustFindCommand('moveObjectsToPage'), { ids: [outer], pageId });
    const before = new Map(store.read().objects);
    const history = createHistory(store, ADA.principalId);
    applyCommand(
      store,
      mustFindCommand('deletePage'),
      { pageId: 'page-1' },
      ADA,
      testEnvironment(99),
    );
    expect(storedInstances(store)).toEqual([]);
    expect(mustGet(store, outer)).toMatchObject({ type: 'frame', name: 'Card' });
    const badge = childrenOf(store, outer).find(({ type }) => type === 'frame');
    expect(childrenOf(store, badge?.id ?? '')[0]).toMatchObject({ type: 'sticky', color: GREEN });
    expect(store.get('loose' as ObjectId)).toBeUndefined();
    expectValid(store);
    expect(history.undo()).toBe(true);
    expect(new Map(store.read().objects)).toEqual(before);
    history.destroy();
  });
});
