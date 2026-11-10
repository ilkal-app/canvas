// Acceptance, from our decision of 2026-10-08: "Use the empty placeholder; keep existing
// storage". Undoing `createComponent` puts the members back where they were and keeps the main
// as a hidden, empty placeholder (`retired: true`, no children, same id), so an instance someone
// placed offline meanwhile keeps its main, size and overrides and resolves retired and empty, never
// `missing-main`; redo brings the content back. A single-step paste of a main inside a pasted
// frame, undone, keeps the whole definition subtree re-rooted at its world placement. Visible
// foreign writes still use the creation undo up. When the creator's offline undo and
// redo race another person's retirement, we chose last writer wins: the
// `retired` flag converges to the winning write, so the main may reappear, and nothing else is
// lost. A redo made after the retirement arrived never overwrites it. No snapshot key, deletion
// intent flag or layout change.
import { describe, expect, it } from 'vitest';

import { validateBoard, type Board, type BoardObject, type ObjectId } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import {
  createChild,
  createComponentPair,
  newFrame,
  newRectangle,
  newSticky,
  placeInstance,
} from '../commands/__fixtures__/component-boards.js';
import {
  fieldOf,
  mustFindCommand,
  overridesOf,
  schemaFunction,
} from '../commands/__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { renameFrameCommand } from '../commands/rename-frame.js';
import { setStyleCommand } from '../commands/set-style.js';
import {
  BOB_ENVIRONMENT,
  boardOf,
  expectValidAndConverged,
  ORDERS,
  recordRepairs,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { ADA_ID, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/** What the schema's `resolveInstance` answers. */
interface ResolvedInstance {
  readonly objects: readonly BoardObject[];
  readonly issue?: string;
  readonly isMainRetired: boolean;
}

/** Where the sticky to wrap sits inside its frame. */
const NOTE_BOX = { x: 20, y: 30, width: 160, height: 160 };

/**
 * An object without its `updatedAt`, which every command stamps (`restore-board.ts` compares
 * content the same way).
 *
 * @param object - The object, or nothing.
 * @returns Its other fields.
 */
function contentOf(object: BoardObject | undefined): Record<string, unknown> | undefined {
  if (object === undefined) return undefined;
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'updatedAt'));
}

/**
 * Every object of a store, by id, without `updatedAt`.
 *
 * @param store - The store.
 * @returns The contents by id.
 */
function contentsOf(store: DocumentStore): Map<string, Record<string, unknown> | undefined> {
  return new Map([...store.read().objects].map(([id, object]) => [id, contentOf(object)]));
}

/**
 * Resolves a stored instance through the schema's `resolveInstance`.
 *
 * @param store - The store.
 * @param instanceId - The instance.
 * @returns What the resolver answers.
 */
function resolve(store: DocumentStore, instanceId: string): ResolvedInstance {
  const resolveInstance = schemaFunction('resolveInstance') as (
    board: Board,
    instance: BoardObject,
  ) => ResolvedInstance;
  return resolveInstance(boardOf(store), mustGet(store, instanceId));
}

/**
 * The children of an object, sorted.
 *
 * @param store - The store.
 * @param parentId - The parent.
 * @returns The children's ids.
 */
function childrenOf(store: DocumentStore, parentId: string): string[] {
  return [...store.references.childrenOf(parentId as ObjectId)].sort();
}

/**
 * Wraps a sticky into a main as Ada, through `createComponent`.
 *
 * @param store - Ada's store.
 * @param noteId - The sticky.
 * @param mainId - The main's id.
 */
function wrap(store: DocumentStore, noteId: string, mainId: string): void {
  applyCommand(store, mustFindCommand('createComponent'), {
    ids: [noteId],
    name: 'Note card',
    componentId: mainId,
  });
}

/**
 * Bob places an instance of a main, 300 × 200, with the note's text overridden to "Hi".
 *
 * @param bob - Bob's store.
 * @param mainId - The main.
 * @param noteId - The main's sticky, the override's path.
 * @returns The instance's id.
 */
function placeLateInstance(bob: DocumentStore, mainId: string, noteId: string): ObjectId {
  const late = placeInstance(
    bob,
    mainId,
    { x: 500, y: 0, width: 300, height: 200, instanceId: 'late' },
    BOB,
    BOB_ENVIRONMENT,
  );
  applyCommand(
    bob,
    mustFindCommand('setInstanceOverride'),
    { id: late, path: noteId, override: { text: 'Hi' } },
    BOB,
    BOB_ENVIRONMENT,
  );
  return late;
}

/**
 * Checks a main is the empty placeholder we chose: retired, no children, still named.
 *
 * @param store - The store.
 * @param mainId - The main.
 */
function expectHollowMain(store: DocumentStore, mainId: string): void {
  expect(mustGet(store, mainId).type).toBe('component');
  expect(fieldOf(store, mainId, 'retired')).toBe(true);
  expect(fieldOf(store, mainId, 'name')).toBe('Note card');
  expect(childrenOf(store, mainId)).toEqual([]);
}

/**
 * Two linked clients with Ada's history over a sticky inside a frame, not yet wrapped.
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @returns The clients, the link, the history and the sticky as created.
 */
function pairWithNote(adaClientId: number, bobClientId: number) {
  const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
    createChild(store, newFrame('home', null, { x: 1000, y: 1000, width: 600, height: 600 }));
    createChild(store, newSticky('note', 'home', NOTE_BOX));
  });
  const history = createHistory(ada, ADA_ID);
  const link = new Link(ada, bob);
  return { ada, bob, link, history, noteBefore: mustGet(ada, 'note') };
}

describe.each(ORDERS)('undoing the creation of a main ($name)', ({ adaClientId, bobClientId }) => {
  it('puts the member back, keeps an empty placeholder for an offline instance, and redo brings the content back', () => {
    const { ada, bob, link, history, noteBefore } = pairWithNote(adaClientId, bobClientId);
    wrap(ada, 'note', 'main');
    link.deliver();
    expect(mustGet(bob, 'note').parentId).toBe('main');
    const repairs = [recordRepairs(ada), recordRepairs(bob)];

    link.disconnect();
    expect(history.undo()).toBe(true);
    const late = placeLateInstance(bob, 'main', 'note');
    link.reconnect();

    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expect(contentOf(mustGet(store, 'note'))).toEqual(contentOf(noteBefore));
      expectHollowMain(store, 'main');
      expect(mustGet(store, late)).toMatchObject({ type: 'instance', width: 300, height: 200 });
      expect(fieldOf(store, late, 'mainId')).toBe('main');
      expect(overridesOf(store, late)).toEqual({ note: { text: 'Hi' } });
      expect(resolve(store, late)).toEqual({ objects: [], issue: undefined, isMainRetired: true });
      expect(validateBoard(store.read())).toEqual([]);
    }
    const touched = repairs
      .flat()
      .filter(({ changes }) =>
        [...changes.created, ...changes.updated, ...changes.deleted].some(
          (id) => id === late || id === 'main',
        ),
      );
    expect(touched).toEqual([]);

    expect(history.redo()).toBe(true);
    link.deliver();
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expect(fieldOf(store, 'main', 'retired')).toBe(false);
      expect(mustGet(store, 'note')).toMatchObject({ parentId: 'main', x: 0, y: 0 });
      expect(fieldOf(store, late, 'mainId')).toBe('main');
      expect(overridesOf(store, late)).toEqual({ note: { text: 'Hi' } });
      const resolved = resolve(store, late);
      expect(resolved.isMainRetired).toBe(false);
      expect(resolved.issue).toBeUndefined();
      expect(resolved.objects).toHaveLength(1);
      expect(resolved.objects[0]).toMatchObject({ type: 'sticky', text: 'Hi' });
    }
    history.destroy();
  });

  it.each([
    {
      write: 'placed an instance of it',
      act: (bob: YjsDocumentStore) =>
        placeInstance(bob, 'main', { x: 500, y: 0, instanceId: 'inst' }, BOB, BOB_ENVIRONMENT),
    },
    {
      write: 'renamed it',
      act: (bob: YjsDocumentStore) =>
        applyCommand(bob, renameFrameCommand, { id: 'main', name: 'Theirs' }, BOB, BOB_ENVIRONMENT),
    },
    {
      write: 'restyled its child',
      act: (bob: YjsDocumentStore) =>
        applyCommand(
          bob,
          setStyleCommand,
          { changes: [{ id: 'note', style: { color: [0.2, 0.6, 1, 1] } }] },
          BOB,
          BOB_ENVIRONMENT,
        ),
    },
  ])('is used up unapplied once another person has $write', ({ act }) => {
    const { ada, bob, link, history } = pairWithNote(adaClientId, bobClientId);
    wrap(ada, 'note', 'main');
    link.deliver();
    act(bob);
    link.deliver();
    const before = contentsOf(ada);

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(history.canRedo()).toBe(false);
    expect(contentsOf(ada)).toEqual(before);
    expect(contentsOf(bob)).toEqual(before);
    expect(fieldOf(ada, 'main', 'retired')).toBe(false);
    expect(mustGet(ada, 'note').parentId).toBe('main');
    expectValidAndConverged(ada, bob);
    history.destroy();
  });

  it('converges by last writer wins when an offline undo and redo race a retirement', () => {
    const { ada, bob, link, history } = pairWithNote(adaClientId, bobClientId);
    wrap(ada, 'note', 'main');
    link.deliver();

    link.disconnect();
    expect(history.undo()).toBe(true);
    expect(history.redo()).toBe(true);
    const late = placeInstance(ada, 'main', { x: 500, y: 0, instanceId: 'adas-late' });
    applyCommand(ada, mustFindCommand('setInstanceOverride'), {
      id: late,
      path: 'note',
      override: { text: 'Hi' },
    });
    applyCommand(bob, deleteObjectsCommand, { ids: ['main'] }, BOB, BOB_ENVIRONMENT);
    link.reconnect();

    // The concurrent writes of `retired` are ordered by Yjs client id: the higher one wins.
    const isRetired = bobClientId > adaClientId;
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'main').type).toBe('component');
      expect(fieldOf(store, 'main', 'retired')).toBe(isRetired);
      expect(mustGet(store, 'note').parentId).toBe('main');
      expect(mustGet(store, late).type).toBe('instance');
      expect(fieldOf(store, late, 'mainId')).toBe('main');
      expect(overridesOf(store, late)).toEqual({ note: { text: 'Hi' } });
      const resolved = resolve(store, late);
      expect(resolved.issue).toBeUndefined();
      expect(resolved.isMainRetired).toBe(isRetired);
      expect(resolved.objects).toHaveLength(1);
      expect(resolved.objects[0]).toMatchObject({ type: 'sticky', text: 'Hi' });
    }
    history.destroy();
  });

  it("never overwrites another person's concurrent retirement with a redo made after it arrived", () => {
    const { ada, bob, link, history } = pairWithNote(adaClientId, bobClientId);
    wrap(ada, 'note', 'main');
    link.deliver();

    link.disconnect();
    expect(history.undo()).toBe(true);
    applyCommand(bob, deleteObjectsCommand, { ids: ['main'] }, BOB, BOB_ENVIRONMENT);
    link.reconnect();
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) expect(fieldOf(store, 'main', 'retired')).toBe(true);

    history.redo();
    link.deliver();
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'main').type).toBe('component');
      expect(fieldOf(store, 'main', 'retired')).toBe(true);
    }
    history.destroy();
  });
});

describe('undoing the creation of a main on one client', () => {
  it('is applied, leaving the empty placeholder, and one redo restores the main', () => {
    const store = new YjsDocumentStore();
    createChild(store, newSticky('note', null, { x: 100, y: 100, width: 160, height: 160 }));
    const noteBefore = mustGet(store, 'note');
    const history = createHistory(store, ADA_ID);
    wrap(store, 'note', 'main');
    const created = contentsOf(store);

    expect(history.undo()).toBe(true);
    expect(contentOf(mustGet(store, 'note'))).toEqual(contentOf(noteBefore));
    expectHollowMain(store, 'main');
    expect(validateBoard(store.read())).toEqual([]);
    expect(history.canRedo()).toBe(true);

    expect(history.redo()).toBe(true);
    expect(contentsOf(store)).toEqual(created);
    expect(fieldOf(store, 'main', 'retired')).toBe(false);
    expect(history.canRedo()).toBe(false);
    history.destroy();
  });

  it('keeps the whole definition of a pasted main, re-rooted at its world placement on its page', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA_ID);
    const { result } = applyCommand(store, mustFindCommand('createObjects'), {
      objects: [
        newFrame('pf', null, { x: 2000, y: 500, width: 800, height: 600 }),
        {
          type: 'component',
          id: 'pm',
          parentId: 'pf',
          x: 50,
          y: 60,
          width: 400,
          height: 300,
          name: 'Pasted',
          retired: false,
        },
        newSticky('pa', 'pm', { x: 0, y: 0, width: 160, height: 160 }),
        newRectangle('pb', 'pm', { x: 200, y: 0, width: 200, height: 100 }),
      ],
    });
    const [frameId, mainId, noteId, boxId] = (result as { ids: readonly string[] }).ids;
    if (!frameId || !mainId || !noteId || !boxId) throw new Error('the paste made no ids');
    const pasted = contentsOf(store);
    const frame = mustGet(store, frameId);
    expect(mustGet(store, mainId).parentId).toBe(frameId);
    expect(childrenOf(store, mainId)).toEqual([noteId, boxId].sort());

    expect(history.undo()).toBe(true);
    expect(store.get(frameId as ObjectId)).toBeUndefined();
    const main = mustGet(store, mainId);
    expect(main).toMatchObject({ type: 'component', parentId: null, x: 2050, y: 560 });
    expect(fieldOf(store, mainId, 'retired')).toBe(true);
    expect(fieldOf(store, mainId, 'name')).toBe('Pasted');
    expect(main.pageId).toBe(frame.pageId);
    expect(main.pageId !== null && main.pageId !== undefined).toBe(true);
    expect(store.read().pages.has(main.pageId as never)).toBe(true);
    expect(childrenOf(store, mainId)).toEqual([noteId, boxId].sort());
    for (const id of [noteId, boxId]) {
      expect(contentOf(mustGet(store, id))).toEqual(pasted.get(id));
    }
    expect(validateBoard(store.read())).toEqual([]);

    expect(history.redo()).toBe(true);
    expect(contentsOf(store)).toEqual(pasted);
    expect(fieldOf(store, mainId, 'retired')).toBe(false);
    history.destroy();
  });
});
