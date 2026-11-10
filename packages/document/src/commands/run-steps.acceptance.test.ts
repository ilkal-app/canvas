import { describe, expect, it, vi } from 'vitest';

import {
  afterParts,
  createHistory,
  createObjectsCommand,
  runCommand,
  RunStoppedError,
  startRun,
  YjsDocumentStore,
} from '@canvas/document';

import { SCOUT_FOR_ADA } from '../history/__fixtures__/history-fixtures.js';
import { depthsOf } from '../history/history-depths.js';
import { ADA, id } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function input(count: number) {
  return {
    objects: [...Array(count).keys()].map((index) =>
      newRectangle(`local-${String(index)}`, null, {
        x: index * 2,
        y: 0,
        width: 1,
        height: 1,
      }),
    ),
  };
}

describe('stepped command delivery', () => {
  it('commits part one synchronously, delivers each part, then matches runCommand', async () => {
    const store = new YjsDocumentStore();
    const synchronous = new YjsDocumentStore();
    const gate = deferred();
    const yieldToBrowser = vi.fn(() => gate.promise);
    const deliveries: number[] = [];
    const partDeliveries: number[] = [];
    const updates: Uint8Array[] = [];
    store.subscribe((changes) => deliveries.push(changes.created.length));
    afterParts(store, () => partDeliveries.push(store.read().objects.size));
    store.subscribeUpdates(({ update }) => updates.push(update));

    const pending = startRun(store, ADA, createObjectsCommand, input(5), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser,
    });
    expect(pending).toBeInstanceOf(Promise);
    if (!(pending instanceof Promise)) throw new Error('expected a stepped run');
    expect(store.read().objects.size).toBeGreaterThan(0);
    expect(store.read().objects.size).toBeLessThan(5);
    expect(deliveries).toHaveLength(1);
    expect(partDeliveries).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(yieldToBrowser).toHaveBeenCalledTimes(1);
    gate.resolve();
    const report = await pending;
    const baseline = runCommand(
      synchronous,
      ADA,
      createObjectsCommand,
      input(5),
      testEnvironment(),
    );
    expect(baseline.status).toBe('applied');
    if (baseline.status !== 'applied') return;
    expect(report.result).toEqual(baseline.result);
    expect(report.changes).toEqual(baseline.changes);
    expect(report.committedParts).toBe(report.parts);
    expect(deliveries).toHaveLength(report.parts);
    expect(partDeliveries).toHaveLength(report.parts);
    expect(updates).toHaveLength(report.parts);
    expect([...store.read().objects.keys()]).toEqual([...synchronous.read().objects.keys()]);
  });

  it('returns a refusal synchronously and never yields for a refusal or unsplit plan', async () => {
    const store = new YjsDocumentStore();
    const yieldToBrowser = vi.fn(() => Promise.resolve());
    const refused = startRun(store, ADA, createObjectsCommand, { objects: [] }, testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser,
    });
    expect(refused).not.toBeInstanceOf(Promise);
    expect(refused).toMatchObject({ status: 'rejected' });
    const applied = startRun(store, ADA, createObjectsCommand, input(1), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser,
    });
    expect(applied).toBeInstanceOf(Promise);
    await applied;
    await store.whenIdle();
    expect(yieldToBrowser).not.toHaveBeenCalled();
    store.transact(ADA, () => undefined);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses invalid maxWrites %s before a write',
    (maxWrites) => {
      const store = new YjsDocumentStore();
      const result = startRun(store, ADA, createObjectsCommand, input(2), testEnvironment(), {
        maxWrites,
        yieldToBrowser: () => Promise.resolve(),
      });
      expect(result).not.toBeInstanceOf(Promise);
      expect(result).toMatchObject({ status: 'rejected' });
      expect(store.read().objects.size).toBe(0);
    },
  );

  it.each([0, 60_000])(
    'keeps all parts in one history step at captureTimeout %i',
    async (captureTimeout) => {
      const store = new YjsDocumentStore();
      const history = createHistory(store, ADA.principalId, { captureTimeout });
      const keyed = createHistory(store, ADA.principalId, { historyKey: 'agent-run' });
      const before = runCommand(store, ADA, createObjectsCommand, input(1), testEnvironment(1));
      expect(before.status).toBe('applied');
      history.stopCapturing();
      const gates = [deferred(), deferred()] as const;
      let next = 0;
      const pending = startRun(store, ADA, createObjectsCommand, input(5), testEnvironment(), {
        maxWrites: 4,
        yieldToBrowser: () => {
          const gate = gates[next++];
          if (gate === undefined) throw new Error('unexpected extra part');
          return gate.promise;
        },
      });
      expect(pending).toBeInstanceOf(Promise);
      if (!(pending instanceof Promise)) throw new Error('expected a stepped run');
      expect(depthsOf(history).undo).toBeGreaterThan(1);
      history.stopCapturing();
      gates[0].resolve();
      await Promise.resolve();
      history.stopCapturing();
      gates[1].resolve();
      const report = await pending;
      expect(depthsOf(history).undo).toBe(1 + report.parts);
      expect(depthsOf(keyed).undo).toBe(0);
      history.stopCapturing();
      runCommand(store, ADA, createObjectsCommand, input(1), testEnvironment(20));
      expect(depthsOf(history).undo).toBe(2 + report.parts);
      expect(history.undo()).toBe(true);
      expect(store.read().objects.size).toBe(6);
      expect(history.undo()).toBe(true);
      expect(store.read().objects.size).toBe(1);
      expect(history.redo()).toBe(true);
      expect(store.read().objects.size).toBe(6);
      expect(store.get(id('missing'))).toBeUndefined();
    },
  );

  it('reports a rejected yield with only already committed parts', async () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const gate = deferred();
    const pending = startRun(store, ADA, createObjectsCommand, input(5), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser: () => gate.promise,
    });
    if (!(pending instanceof Promise)) throw new Error('expected a stepped run');
    expect(store.read().objects.size).toBeGreaterThan(0);
    const committed = store.read().objects.size;
    gate.reject(new Error('browser yield failed'));
    await expect(pending).rejects.toBeInstanceOf(RunStoppedError);
    await expect(pending).rejects.toMatchObject({ committedParts: 1 });
    await pending.catch((error: unknown) => {
      if (!(error instanceof RunStoppedError)) throw error;
      expect(error.cause).toMatchObject({ message: 'browser yield failed' });
      expect(error.changes?.created).toBeInstanceOf(Array);
    });
    expect(store.read().objects.size).toBe(committed);
    expect(depthsOf(history).undo).toBe(1);
    await store.whenIdle();
    expect(history.undo()).toBe(true);
  });

  it('groups an agent run only in its matching per-key history', async () => {
    const store = new YjsDocumentStore();
    const defaultHistory = createHistory(store, ADA.principalId);
    const keyedHistory = createHistory(store, ADA.principalId, { historyKey: 'agent-run' });
    const origin = { ...SCOUT_FOR_ADA, historyKey: 'agent-run' };
    const started = startRun(store, origin, createObjectsCommand, input(5), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser: () => Promise.resolve(),
    });
    if (!(started instanceof Promise)) throw new Error('expected a stepped run');
    const report = await started;
    expect(depthsOf(defaultHistory).undo).toBe(0);
    expect(depthsOf(keyedHistory).undo).toBe(report.parts);
    expect(keyedHistory.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);
  });

  it.each(['store', 'afterParts'] as const)(
    'counts a committed first part when a %s listener throws',
    async (phase) => {
      const store = new YjsDocumentStore();
      const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
      const cause = new Error(`${phase} delivery failed`);
      const stop =
        phase === 'store'
          ? store.subscribe(() => {
              throw cause;
            })
          : afterParts(store, () => {
              throw cause;
            });
      const pending = startRun(store, ADA, createObjectsCommand, input(5), testEnvironment(), {
        maxWrites: 4,
        yieldToBrowser: () => Promise.resolve(),
      });
      await expect(pending).rejects.toBeInstanceOf(RunStoppedError);
      await expect(pending).rejects.toMatchObject({
        committedParts: 1,
        cause,
      });
      expect(store.read().objects.size).toBeGreaterThan(0);
      expect(store.read().objects.size).toBeLessThan(5);
      expect(depthsOf(history).undo).toBe(1);
      await store.whenIdle();
      stop();
      expect(history.undo()).toBe(true);
    },
  );

  it('stops after apply throws in a later part and releases the store', async () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const cause = new Error('apply failed');
    let calls = 0;
    const command = {
      ...createObjectsCommand,
      apply: (...args: Parameters<typeof createObjectsCommand.apply>) => {
        calls += 1;
        if (calls === 3) throw cause;
        return createObjectsCommand.apply(...args);
      },
    };
    const pending = startRun(store, ADA, command, input(5), testEnvironment(), {
      maxWrites: 4,
      yieldToBrowser: () => Promise.resolve(),
    });
    await expect(pending).rejects.toBeInstanceOf(RunStoppedError);
    await expect(pending).rejects.toMatchObject({
      committedParts: 1,
      cause,
    });
    expect(calls).toBe(3);
    expect(depthsOf(history).undo).toBe(1);
    await store.whenIdle();
  });
});
