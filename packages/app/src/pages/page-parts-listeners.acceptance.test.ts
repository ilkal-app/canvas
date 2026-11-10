import { describe, expect, it } from 'vitest';

import {
  addPageCommand,
  createHistory,
  createLargeBoardObjects,
  createObjectsCommand,
  deleteObjectsCommand,
  forwardUndoSteps,
  runAsOneStep,
  runCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type ChangeSet,
  type CommandEnvironment,
  type DocumentStore,
  type NewObject,
  type TransactionOrigin,
} from '@canvas/document';
import {
  createSeededIdGenerator,
  type ObjectId,
  type PageId,
  type PrincipalId,
} from '@canvas/schema';

import { createPageView } from './create-page-view.js';
import { PageBoardStore } from './page-board-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const GENERATED = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

function environment(seed: number): CommandEnvironment {
  return { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(seed) };
}

function listed(count: number): NewObject[] {
  return createLargeBoardObjects(count, 557).map(
    (object) =>
      Object.fromEntries(
        Object.entries(object).filter(([key]) => !GENERATED.has(key)),
      ) as unknown as NewObject,
  );
}

function create(
  store: DocumentStore,
  count: number,
  seed: number,
  origin: TransactionOrigin = ORIGIN,
): readonly ObjectId[] {
  const outcome = runCommand(
    store,
    origin,
    createObjectsCommand,
    { objects: listed(count) },
    environment(seed),
  );
  if (outcome.status === 'rejected') throw new Error(JSON.stringify(outcome.errors));
  return outcome.result.ids;
}

function remove(store: DocumentStore, ids: readonly ObjectId[]): void {
  const outcome = runCommand(
    store,
    ORIGIN,
    deleteObjectsCommand,
    { ids: [...ids] },
    environment(3),
  );
  if (outcome.status === 'rejected') throw new Error(JSON.stringify(outcome.errors));
  expect(outcome.result.deletedIds).toHaveLength(ids.length);
}

function changedIds(changes: readonly ChangeSet[], field: 'created' | 'deleted'): ObjectId[] {
  return changes.flatMap((change) => [...change[field]].sort());
}

// Insert a synchronous update between split parts, outside the store's transaction guard.
function interrupt(writer: DocumentStore, root: DocumentStore, inject: () => void): DocumentStore {
  let didInject = false;
  const interrupted = new Proxy(writer, {
    get(target, property) {
      if (property === 'transact') {
        return (...args: Parameters<DocumentStore['transact']>) => {
          const result = target.transact(...args);
          if (!didInject) {
            didInject = true;
            inject();
          }
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
  forwardUndoSteps(interrupted, root);
  return interrupted;
}

describe('page listeners for commands in parts', { timeout: 60_000 }, () => {
  it.each(['page', 'board'] as const)(
    'delivers one ordered set for 2,500 creates, deletes, undo and redo through the %s writer',
    (kind) => {
      const store = new YjsDocumentStore();
      const { view, release } = createPageView(store, ORIGIN, environment(1), {});
      const writer = kind === 'page' ? view : new PageBoardStore(store, () => view.page);
      const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
      const pageChanges: ChangeSet[] = [];
      const boardChanges: ChangeSet[] = [];
      const stopPage = view.subscribe((changes) => pageChanges.push(changes));
      const stopBoard = store.subscribe((changes) => boardChanges.push(changes));

      const ids = create(writer, 2_500, 2);
      expect(ids).toHaveLength(2_500);
      expect(boardChanges.length).toBeGreaterThan(1);
      expect(pageChanges).toHaveLength(1);
      expect(pageChanges[0]?.created).toEqual(changedIds(boardChanges, 'created'));
      expect(pageChanges[0]?.updated).toEqual([]);
      expect(pageChanges[0]?.deleted).toEqual([]);

      pageChanges.length = 0;
      boardChanges.length = 0;
      remove(writer, ids);
      expect(boardChanges.length).toBeGreaterThan(1);
      expect(pageChanges).toHaveLength(1);
      expect(pageChanges[0]?.deleted).toEqual(changedIds(boardChanges, 'deleted'));
      expect(pageChanges[0]?.created).toEqual([]);

      pageChanges.length = 0;
      boardChanges.length = 0;
      expect(history.undo()).toBe(true);
      expect(boardChanges.length).toBeGreaterThan(1);
      expect(pageChanges).toHaveLength(1);
      expect(pageChanges[0]?.created).toEqual(changedIds(boardChanges, 'created'));
      expect(pageChanges[0]?.deleted).toEqual([]);

      pageChanges.length = 0;
      boardChanges.length = 0;
      expect(history.redo()).toBe(true);
      expect(boardChanges.length).toBeGreaterThan(1);
      expect(pageChanges).toHaveLength(1);
      expect(pageChanges[0]?.deleted).toEqual(changedIds(boardChanges, 'deleted'));
      expect(pageChanges[0]?.created).toEqual([]);

      stopBoard();
      stopPage();
      history.destroy();
      if (writer !== view) writer.destroy();
      release();
      store.destroy();
    },
  );

  it('delivers an unsplit command at once', () => {
    const store = new YjsDocumentStore();
    const { view, release } = createPageView(store, ORIGIN, environment(1), {});
    const changes: ChangeSet[] = [];
    const stop = view.subscribe((change) => changes.push(change));

    const ids = create(view, 1, 2);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.created).toEqual(ids);

    stop();
    release();
    store.destroy();
  });

  it('delivers a split command started by a page listener as its own merged set and undo step', () => {
    const store = new YjsDocumentStore();
    const { view, release } = createPageView(store, ORIGIN, environment(1), {});
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    const changes: ChangeSet[] = [];
    const boardChanges: ChangeSet[] = [];
    let firstBoardChanges: ChangeSet[] = [];
    let followUpIds: readonly ObjectId[] = [];
    let didFollowUp = false;
    const stopBoard = store.subscribe((change) => boardChanges.push(change));
    const stop = view.subscribe((change) => {
      changes.push(change);
      if (didFollowUp) return;
      didFollowUp = true;
      firstBoardChanges = boardChanges.slice();
      followUpIds = create(view, 2_500, 3);
    });

    expect(create(view, 2_500, 2)).toHaveLength(2_500);

    expect(followUpIds).toHaveLength(2_500);
    expect(changes).toHaveLength(2);
    expect(firstBoardChanges.length).toBeGreaterThan(1);
    expect(boardChanges.length - firstBoardChanges.length).toBeGreaterThan(1);
    expect(changes[0]?.created).toEqual(changedIds(firstBoardChanges, 'created'));
    expect(changes[1]?.created).toEqual(
      changedIds(boardChanges.slice(firstBoardChanges.length), 'created'),
    );
    expect(changes.map((change) => change.origin)).toEqual([ORIGIN, ORIGIN]);
    stop();
    stopBoard();

    expect(history.undo()).toBe(true);
    expect(view.read().objects.size).toBe(2_500);
    expect(followUpIds.every((id) => view.get(id) === undefined)).toBe(true);
    expect(history.undo()).toBe(true);
    expect(view.read().objects.size).toBe(0);

    history.destroy();
    release();
    store.destroy();
  });

  it('delivers a remote interruption before a listener command without joining their undo steps', () => {
    const store = new YjsDocumentStore();
    const { view, release } = createPageView(store, ORIGIN, environment(1), {});
    const remote = new YjsDocumentStore();
    remote.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
    const remoteIds = create(remote, 1, 10);
    const history = createHistory(store, ORIGIN.principalId, { captureTimeout: 0 });
    const boardChanges: ChangeSet[] = [];
    const pageChanges: ChangeSet[] = [];
    let followUpIds: readonly ObjectId[] = [];
    const stopBoard = store.subscribe((change) => boardChanges.push(change));
    const writer = interrupt(view, store, () => {
      store.applyUpdate(remote.encodeState(store.encodeStateVector()), { ...ORIGIN });
    });
    const stopPage = view.subscribe((change) => {
      pageChanges.push(change);
      if (pageChanges.length === 1) followUpIds = create(view, 1, 3);
    });
    const splitIds = create(writer, 2_500, 2);
    expect(followUpIds).toHaveLength(1);
    const firstLocalIds = changedIds(boardChanges.slice(0, 1), 'created');
    const remainingLocalIds = changedIds(boardChanges.slice(2, -1), 'created');
    expect([...firstLocalIds, ...remainingLocalIds].sort()).toEqual([...splitIds].sort());
    expect(pageChanges).toHaveLength(4);
    expect(pageChanges.map((change) => change.created)).toEqual([
      firstLocalIds,
      remoteIds,
      remainingLocalIds,
      [...followUpIds],
    ]);
    expect(pageChanges.map((change) => change.origin)).toEqual([ORIGIN, ORIGIN, ORIGIN, ORIGIN]);
    expect(pageChanges.map((change) => change.isLocal)).toEqual([true, false, true, true]);
    stopPage();
    stopBoard();
    expect(history.undo()).toBe(true);
    expect(followUpIds.every((id) => view.get(id) === undefined)).toBe(true);
    expect(splitIds.every((id) => view.get(id) !== undefined)).toBe(true);
    expect(history.undo()).toBe(true);
    expect(splitIds.every((id) => view.get(id) === undefined)).toBe(true);
    expect(remoteIds.every((id) => view.get(id) !== undefined)).toBe(true);
    history.destroy();
    remote.destroy();
    release();
    store.destroy();
  });

  it('delivers every queued source batch when the first page listener call throws', () => {
    const store = new YjsDocumentStore();
    const { view, release } = createPageView(store, ORIGIN, environment(1), {});
    const remote = new YjsDocumentStore();
    remote.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
    const remoteIds = create(remote, 1, 10);
    const boardChanges: ChangeSet[] = [];
    const delivered: ChangeSet[] = [];
    const failure = new Error('first page listener call failed');
    let calls = 0;
    const stopBoard = store.subscribe((change) => boardChanges.push(change));
    const writer = interrupt(view, store, () => {
      store.applyUpdate(remote.encodeState(store.encodeStateVector()), { ...ORIGIN });
    });
    const stopThrowing = view.subscribe(() => {
      calls += 1;
      if (calls === 1) throw failure;
    });
    const stopRecording = view.subscribe((change) => delivered.push(change));
    expect(() => create(writer, 2_500, 2)).toThrow(failure);
    expect(delivered.map((change) => change.created)).toEqual([
      changedIds(boardChanges.slice(0, 1), 'created'),
      remoteIds,
      changedIds(boardChanges.slice(2), 'created'),
    ]);
    expect(delivered.map((change) => change.isLocal)).toEqual([true, false, true]);
    expect(calls).toBe(3);
    stopRecording();
    stopThrowing();
    stopBoard();
    remote.destroy();
    release();
    store.destroy();
  });

  it.each(['remote', 'system'] as const)(
    'keeps %s changes between split local parts in a separate ordered set',
    (source) => {
      const store = new YjsDocumentStore();
      const { view, release } = createPageView(store, ORIGIN, environment(1), {});
      const remote = new YjsDocumentStore();
      remote.applyUpdate(store.encodeState(), SYSTEM_ORIGIN);
      const remoteIds = source === 'remote' ? create(remote, 1, 10) : [];
      const changes: ChangeSet[] = [];
      const stopPage = view.subscribe((change) => changes.push(change));
      let firstPartIds: readonly ObjectId[] = [];
      let injectedIds: readonly ObjectId[] = [];
      let remainingIds: readonly ObjectId[] = [];

      runAsOneStep(view, () => {
        firstPartIds = [...create(view, 1, 2), ...create(view, 1, 3)];
        if (source === 'remote') {
          injectedIds = remoteIds;
          // Equal user origins may be different objects; locality still separates the sets.
          store.applyUpdate(remote.encodeState(store.encodeStateVector()), { ...ORIGIN });
        } else {
          injectedIds = create(store, 1, 10, SYSTEM_ORIGIN);
        }
        remainingIds = [...create(view, 1, 4), ...create(view, 1, 5)];
      });

      expect(firstPartIds.length).toBeGreaterThan(0);
      expect(remainingIds.length).toBeGreaterThan(0);
      expect(injectedIds).toHaveLength(1);
      expect(changes).toHaveLength(3);
      expect(changes.map((change) => change.created)).toEqual([
        firstPartIds,
        [...injectedIds],
        remainingIds,
      ]);
      expect(changes.map((change) => change.origin)).toEqual([
        ORIGIN,
        source === 'remote' ? ORIGIN : SYSTEM_ORIGIN,
        ORIGIN,
      ]);
      expect(changes.map((change) => change.isLocal)).toEqual([true, source === 'system', true]);

      stopPage();
      remote.destroy();
      release();
      store.destroy();
    },
  );

  it('merges created then updated, created then deleted, and deleted then created', () => {
    const store = new YjsDocumentStore();
    const { view, release } = createPageView(store, ORIGIN, environment(1), {});
    const [existingId] = create(view, 1, 2);
    if (existingId === undefined) throw new Error('expected an existing object');
    const existing = view.get(existingId);
    if (existing === undefined) throw new Error('expected an existing object');
    const changes: ChangeSet[] = [];
    const stop = view.subscribe((change) => changes.push(change));
    let keptId: ObjectId | undefined;
    const addedPages: PageId[] = [];

    runAsOneStep(view, () => {
      const [createdId, droppedId] = create(view, 2, 3);
      if (createdId === undefined || droppedId === undefined) throw new Error('expected two ids');
      keptId = createdId;
      view.transact(ORIGIN, (transaction) => {
        transaction.patchObject(createdId, { x: 123 });
      });
      view.transact(ORIGIN, (transaction) => {
        transaction.deleteObject(droppedId);
      });
      view.transact(ORIGIN, (transaction) => {
        transaction.deleteObject(existingId);
      });
      view.transact(ORIGIN, (transaction) => {
        transaction.setObject(existing);
      });
      for (const seed of [4, 5]) {
        const outcome = runCommand(
          view,
          ORIGIN,
          addPageCommand,
          { name: `Page ${String(seed)}` },
          environment(seed),
        );
        if (outcome.status === 'rejected') throw new Error(JSON.stringify(outcome.errors));
        addedPages.push(outcome.result.pageId);
      }
      expect(changes).toEqual([]);
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]?.created).toEqual([keptId]);
    expect(changes[0]?.updated).toEqual([existingId]);
    expect(changes[0]?.deleted).toEqual([]);
    expect(changes[0]?.origin).toEqual(ORIGIN);
    expect(changes[0]?.isLocal).toBe(true);
    const [firstPage, secondPage] = addedPages;
    if (firstPage === undefined || secondPage === undefined) throw new Error('expected two pages');
    expect(changes[0]?.pages).toEqual([...[view.page, firstPage].sort(), secondPage]);

    stop();
    release();
    store.destroy();
  });
});
