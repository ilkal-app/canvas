import { describe, expect, it } from 'vitest';

import {
  afterParts,
  createHistory,
  createObjectsCommand,
  startRun,
  StoreBusyError,
  StoreDestroyedError,
  YjsDocumentStore,
} from '@canvas/document';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { newRectangle } from '../commands/__fixtures__/component-boards.js';

import { ADA, BOB, RELAY } from './__fixtures__/store-fixtures.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function largeInput() {
  return {
    objects: [...Array(5).keys()].map((index) =>
      newRectangle(`object-${String(index)}`, null, { x: index * 2, y: 0, width: 1, height: 1 }),
    ),
  };
}

describe('exclusive store run', () => {
  it('authorizes only synchronous work inside run.enter', async () => {
    const store = new YjsDocumentStore();
    const run = store.beginRun();
    expect(() => {
      store.transact(ADA, () => undefined);
    }).toThrow(StoreBusyError);
    run.enter(() => {
      store.transact(ADA, () => undefined);
    });
    expect(() => {
      store.transact(ADA, () => undefined);
    }).toThrow(StoreBusyError);
    run.close();
    await store.whenIdle();
    store.transact(ADA, () => undefined);
  });

  it('rejects every foreign mutation path between parts before it changes state', async () => {
    const store = new YjsDocumentStore();
    const remote = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId);
    const otherHistory = createHistory(store, BOB.principalId);
    const gate = deferred();
    const pending = startRun(store, ADA, createObjectsCommand, largeInput(), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser: () => gate.promise,
    });
    const before = store.encodeState();
    const update = remote.encodeState();
    const mutations = [
      () => {
        store.transact(ADA, () => undefined);
      },
      () => {
        store.transact(BOB, () => undefined);
      },
      () => {
        store.transact(RELAY, () => undefined);
      },
      () => {
        store.applyUpdate(update, RELAY);
      },
      () => history.undo(),
      () => otherHistory.undo(),
      () => store.applyUpdateInSteps(update, RELAY, { yieldToBrowser: () => Promise.resolve() }),
      () => {
        store.setRepairMode('write');
      },
    ];
    for (const mutate of mutations) {
      expect(mutate).toThrow(StoreBusyError);
      expect(store.encodeState()).toEqual(before);
    }
    expect(store.read().objects.size).toBeGreaterThan(0);
    expect(store.references).toBeDefined();
    gate.resolve();
    await pending;
    await store.whenIdle();
    store.transact(ADA, () => undefined);
  });

  it('removes run.enter authority before afterParts listeners, then settles all idle waiters', async () => {
    const store = new YjsDocumentStore();
    const remote = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId);
    const gate = deferred();
    const update = remote.encodeState();
    let deliveries = 0;
    const stop = afterParts(store, () => {
      deliveries += 1;
      const before = store.encodeState();
      for (const mutate of [
        () => {
          store.transact(ADA, () => undefined);
        },
        () => {
          store.applyUpdate(update, RELAY);
        },
        () => history.undo(),
        () => store.applyUpdateInSteps(update, RELAY, { yieldToBrowser: () => Promise.resolve() }),
        () => {
          store.setRepairMode('write');
        },
      ]) {
        expect(mutate).toThrow(StoreBusyError);
        expect(store.encodeState()).toEqual(before);
      }
    });
    const pending = startRun(store, ADA, createObjectsCommand, largeInput(), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser: () => gate.promise,
    });
    if (!(pending instanceof Promise)) throw new Error('expected a stepped run');
    const order: string[] = [];
    const idle = [1, 2, 3].map((number) =>
      store.whenIdle().then(() => {
        order.push(`idle-${String(number)}`);
      }),
    );
    expect(deliveries).toBe(1);
    expect(order).toEqual([]);
    gate.resolve();
    const report = await pending;
    await Promise.all(idle);
    expect(deliveries).toBe(report.parts);
    expect(order).toHaveLength(3);
    stop();
  });

  it('rejects idle waiters if the store is destroyed while a run is suspended', async () => {
    const store = new YjsDocumentStore();
    const gate = deferred();
    const pending = startRun(store, ADA, createObjectsCommand, largeInput(), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser: () => gate.promise,
    });
    const waiters = [store.whenIdle(), store.whenIdle(), store.whenIdle()];
    store.destroy();
    gate.resolve();
    await Promise.all(
      waiters.map((waiter) => expect(waiter).rejects.toBeInstanceOf(StoreDestroyedError)),
    );
    await expect(pending).rejects.toMatchObject({ committedParts: 1 });
  });
});
