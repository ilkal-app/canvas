import { describe, expect, it, vi } from 'vitest';

import {
  createHistory,
  createLargeBoardObjects,
  createObjectsCommand,
  deleteObjectsCommand,
  deletePageCommand,
  duplicatePageCommand,
  runCommand,
  RunStoppedError,
  startRun,
  StoreBusyError,
  YjsDocumentStore,
} from '@canvas/document';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import {
  newRectangle,
  placeInstance,
  seedMainWithChildren,
} from '../commands/__fixtures__/component-boards.js';
import {
  ADA,
  BOB,
  RELAY,
  exchange,
  id,
  unreadableEntries,
} from '../store/__fixtures__/store-fixtures.js';

import { FAR_WIDTH, mergeRaw } from './__fixtures__/door-fixtures.js';
import { CreationGuard } from './creation-guard.js';
import { DefinitionGuard } from './definition-guard.js';
import { DoorGuard } from './door-guard.js';
import { depthsOf } from './history-depths.js';

function seeded() {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(750, 47);
  store.transact(RELAY, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return { store, objects };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('stepped history restore', () => {
  it('undoes and redoes a component deletion with guards held across yields', async () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId);
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const command = startRun(
      store,
      ADA,
      deleteObjectsCommand,
      { ids: [id(mainId)] },
      testEnvironment(30),
      {
        maxWrites: 4,
        yieldToBrowser: () => Promise.resolve(),
      },
    );
    if (!(command instanceof Promise)) throw new Error('expected a stepped component delete');
    await command;
    expect(store.get(id(mainId))).toBeDefined();
    const gate = deferred();
    const undo = history.startRestore('undo', { yieldToBrowser: () => gate.promise });
    if (!(undo instanceof Promise)) throw new Error('expected a stepped component undo');
    expect(() => {
      store.transact(BOB, () => undefined);
    }).toThrow(StoreBusyError);
    gate.resolve();
    await undo;
    expect(store.get(id(mainId))?.type).toBe('component');
    expect(store.get(id(instanceId))?.type).toBe('instance');
    const redo = history.startRestore('redo', { yieldToBrowser: () => Promise.resolve() });
    if (!(redo instanceof Promise)) throw new Error('expected a stepped component redo');
    await redo;
    expect(unreadableEntries(store)).toEqual([]);
    await store.whenIdle();
  });

  it('undoes and redoes a page deletion while the page stays valid at each part', async () => {
    const { store } = seeded();
    const sourcePage = [...store.readPages().keys()][0];
    if (sourcePage === undefined) throw new Error('missing source page');
    const copy = runCommand(
      store,
      ADA,
      duplicatePageCommand,
      { pageId: sourcePage },
      testEnvironment(),
    );
    if (copy.status !== 'applied') throw new Error('page copy was refused');
    const pageId = copy.result.pageId;
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const command = startRun(store, ADA, deletePageCommand, { pageId }, testEnvironment(), {
      maxWrites: 500,
      yieldToBrowser: () => Promise.resolve(),
    });
    if (!(command instanceof Promise)) throw new Error('expected a stepped page delete');
    await command;
    expect(store.readPages().has(pageId)).toBe(false);
    const gate = deferred();
    const undo = history.startRestore('undo', { yieldToBrowser: () => gate.promise });
    if (!(undo instanceof Promise)) throw new Error('expected a stepped page undo');
    expect(store.readPages().has(pageId)).toBe(true);
    gate.resolve();
    await undo;
    expect(unreadableEntries(store)).toEqual([]);
    const redo = history.startRestore('redo', { yieldToBrowser: () => Promise.resolve() });
    if (!(redo instanceof Promise)) throw new Error('expected a stepped page redo');
    await redo;
    expect(store.readPages().has(pageId)).toBe(false);
  });

  it('matches synchronous undo for a foreign edited creation across yields', async () => {
    const prepare = async () => {
      const store = new YjsDocumentStore();
      const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
      const objects = [...Array(5).keys()].map((index) =>
        newRectangle(`local-${String(index)}`, null, {
          x: index * 10,
          y: 0,
          width: 5,
          height: 5,
        }),
      );
      const started = startRun(store, ADA, createObjectsCommand, { objects }, testEnvironment(), {
        maxWrites: 4,
        yieldToBrowser: () => Promise.resolve(),
      });
      if (!(started instanceof Promise)) throw new Error('expected a stepped run');
      const created = await started;
      const editedId = created.result.ids[0];
      if (editedId === undefined) throw new Error('missing created object');
      const original = store.get(editedId);
      if (original?.type !== 'shape') throw new Error('missing created shape');
      const bob = new YjsDocumentStore();
      exchange(store, bob);
      bob.transact(BOB, (transaction) => {
        transaction.setObject({ ...original, x: original.x + 1 });
      });
      exchange(store, bob);
      return { store, history, editedId };
    };
    const baseline = await prepare();
    const stepped = await prepare();
    expect(baseline.history.undo()).toBe(true);
    const { store, history, editedId } = stepped;
    const gate = deferred();
    const restoring = history.startRestore('undo', { yieldToBrowser: () => gate.promise });
    if (!(restoring instanceof Promise)) throw new Error('expected a stepped restore');
    expect(() => {
      store.transact(BOB, () => undefined);
    }).toThrow(StoreBusyError);
    gate.resolve();
    await restoring;
    expect(store.get(editedId)).toEqual(baseline.store.get(baseline.editedId));
    expect(store.read().objects).toEqual(baseline.store.read().objects);
    await store.whenIdle();
  });

  it('carries a door omission across yielded parts of a delete undo', async () => {
    const { store, objects } = seeded();
    const poisoned = objects.find((object) => object.type === 'shape');
    if (poisoned === undefined) throw new Error('seed has no shape');
    mergeRaw(store, poisoned.id, 'size', { width: FAR_WIDTH });
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const started = startRun(
      store,
      ADA,
      deleteObjectsCommand,
      { ids: objects.map((object) => object.id) },
      testEnvironment(),
      { maxWrites: 500, yieldToBrowser: () => Promise.resolve() },
    );
    if (!(started instanceof Promise)) throw new Error('expected a stepped run');
    await started;
    const gate = deferred();
    const restoring = history.startRestore('undo', { yieldToBrowser: () => gate.promise });
    if (!(restoring instanceof Promise)) throw new Error('expected a stepped restore');
    gate.resolve();
    const report = await restoring;
    expect(report.omission).toBe('out-of-range');
    expect(report.omittedObjects).toBe(1);
    expect(store.get(poisoned.id)).toBeUndefined();
    expect(unreadableEntries(store)).toEqual([]);
  });

  it.each(['undo', 'redo'] as const)(
    'holds the restore group across %s yields',
    async (direction) => {
      const { store, objects } = seeded();
      const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
      const another = createHistory(store, BOB.principalId);
      const command = startRun(
        store,
        ADA,
        deleteObjectsCommand,
        { ids: objects.map((object) => object.id) },
        testEnvironment(),
        { maxWrites: 500, yieldToBrowser: () => Promise.resolve() },
      );
      expect(command).toBeInstanceOf(Promise);
      if (!(command instanceof Promise)) throw new Error('expected a stepped run');
      const commandReport = await command;
      expect(commandReport.parts).toBeGreaterThan(1);
      if (direction === 'redo') {
        const undone = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
        expect(undone).toBeInstanceOf(Promise);
        if (!(undone instanceof Promise)) throw new Error('expected a stepped restore');
        await undone;
      }
      const gate = deferred();
      const restoring = history.startRestore(direction, { yieldToBrowser: () => gate.promise });
      expect(restoring).toBeInstanceOf(Promise);
      if (!(restoring instanceof Promise)) throw new Error('expected a stepped restore');
      expect(() => {
        store.transact(BOB, () => undefined);
      }).toThrow(StoreBusyError);
      expect(() => another.undo()).toThrow(StoreBusyError);
      expect(unreadableEntries(store)).toEqual([]);
      gate.resolve();
      const report = await restoring;
      expect(report.omission).toBeUndefined();
      expect(report.protection).toBeUndefined();
      expect(unreadableEntries(store)).toEqual([]);
      await store.whenIdle();
      expect(depthsOf(history)[direction]).toBe(0);
      expect(store.read().objects.size).toBe(direction === 'undo' ? 750 : 0);
    },
  );

  it('closes guards and busy state when a restore yield rejects', async () => {
    const { store, objects } = seeded();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    await startRun(
      store,
      ADA,
      deleteObjectsCommand,
      { ids: objects.map((object) => object.id) },
      testEnvironment(),
      { maxWrites: 500, yieldToBrowser: () => Promise.resolve() },
    );
    const gate = deferred();
    const restoring = history.startRestore('undo', { yieldToBrowser: () => gate.promise });
    expect(restoring).toBeInstanceOf(Promise);
    if (!(restoring instanceof Promise)) throw new Error('expected a stepped restore');
    gate.reject(new Error('restore yield failed'));
    await expect(restoring).rejects.toMatchObject({ committedParts: 1 });
    await restoring.catch((error: unknown) => {
      if (!(error instanceof RunStoppedError)) throw error;
      expect(error.cause).toMatchObject({ message: 'restore yield failed' });
    });
    await store.whenIdle();
    store.transact(ADA, () => undefined);
    expect(unreadableEntries(store)).toEqual([]);
  });

  it('ends already begun guards when a later beginGroup throws', async () => {
    const { store, objects } = seeded();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    await startRun(
      store,
      ADA,
      deleteObjectsCommand,
      { ids: objects.map((object) => object.id) },
      testEnvironment(),
      { maxWrites: 500, yieldToBrowser: () => Promise.resolve() },
    );
    const definitionEnd = vi.spyOn(DefinitionGuard.prototype, 'endGroup');
    const creationEnd = vi.spyOn(CreationGuard.prototype, 'endGroup');
    const cause = new Error('door begin failed');
    const doorBegin = vi.spyOn(DoorGuard.prototype, 'beginGroup').mockImplementationOnce(() => {
      throw cause;
    });
    const restoring = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
    await expect(restoring).rejects.toMatchObject({ cause });
    expect(definitionEnd).toHaveBeenCalledTimes(1);
    expect(creationEnd).toHaveBeenCalledTimes(1);
    doorBegin.mockRestore();
    definitionEnd.mockRestore();
    creationEnd.mockRestore();
    await store.whenIdle();
    expect(history.undo()).toBe(true);
  });

  it('releases the run when a guard endGroup throws after restore commits', async () => {
    const { store, objects } = seeded();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const command = await startRun(
      store,
      ADA,
      deleteObjectsCommand,
      { ids: objects.map((object) => object.id) },
      testEnvironment(),
      { maxWrites: 500, yieldToBrowser: () => Promise.resolve() },
    );
    if (!('parts' in command)) throw new Error('expected a run report');
    const cause = new Error('guard end failed');
    const end = vi.spyOn(DoorGuard.prototype, 'endGroup').mockImplementationOnce(function (
      this: DoorGuard,
    ) {
      end.mockRestore();
      this.endGroup();
      throw cause;
    });
    const restoring = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
    await expect(restoring).rejects.toMatchObject({ cause, committedParts: command.parts });
    end.mockRestore();
    await store.whenIdle();
    store.transact(ADA, () => undefined);
    expect(unreadableEntries(store)).toEqual([]);
  });
});
