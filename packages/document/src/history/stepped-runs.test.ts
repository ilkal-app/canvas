// The edges of stepped runs and restores that the acceptance tests do not reach.
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { testEnvironment } from '../commands/__fixtures__/command-fixtures.js';
import { newRectangle } from '../commands/__fixtures__/component-boards.js';
import { createObjectsCommand } from '../commands/create-objects.js';
import { runCommand } from '../commands/run-command.js';
import { startRun } from '../commands/start-run.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { RunStoppedError } from '../store/store-run.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { openStep, runAsOneStep, UndoGroups } from './undo-groups.js';
import { createHistory } from './undo-manager.js';

const rectangles = (count: number) => ({
  objects: [...Array(count).keys()].map((index) =>
    newRectangle(`local-${String(index)}`, null, { x: index * 2, y: 0, width: 1, height: 1 }),
  ),
});

describe('stepped runs and restores', () => {
  it('joins a step already open, and ends a step once', () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    runAsOneStep(store, () => {
      const end = openStep(store);
      runCommand(store, ADA, createObjectsCommand, rectangles(1), testEnvironment(1));
      end();
      runCommand(store, ADA, createObjectsCommand, rectangles(1), testEnvironment(2));
    });
    expect(history.undo()).toBe(true);
    expect(store.read().objects.size).toBe(0);
    const end = openStep(store);
    end();
    end();
  });

  it('leaves no group restoring when a synchronous restore cannot begin it', () => {
    const store = new YjsDocumentStore();
    const groups = new UndoGroups(store, {
      beginGroup: () => {
        throw new Error('begin failed');
      },
      endGroup: () => undefined,
    });
    const undoStack: { readonly meta: Map<string, unknown> }[] = [];
    const manager = { undoStack, redoStack: [], captureTimeout: 0 } as unknown as Y.UndoManager;
    runAsOneStep(store, () => {
      groups.beforeCapture(manager);
      const step = { meta: new Map<string, unknown>() };
      undoStack.push(step);
      groups.onStepAdded({ stackItem: step });
    });
    expect(() => groups.restore(manager, 'undo', () => true)).toThrow('begin failed');
    const later = { meta: new Map<string, unknown>() };
    groups.onStepAdded({ stackItem: later });
    expect(later.meta.size).toBe(0);
  });

  it('restores a group in steps with no guard listener', async () => {
    const store = new YjsDocumentStore();
    const groups = new UndoGroups(store);
    const undoStack: { readonly meta: Map<string, unknown> }[] = [];
    const manager = { undoStack, redoStack: [], captureTimeout: 0 } as unknown as Y.UndoManager;
    runAsOneStep(store, () => {
      for (let part = 0; part < 2; part += 1) {
        groups.beforeCapture(manager);
        const step = { meta: new Map<string, unknown>() };
        undoStack.push(step);
        groups.onStepAdded({ stackItem: step });
      }
    });
    const report = await groups.restoreInSteps(
      manager,
      'undo',
      () => undoStack.pop() !== undefined,
      () => undefined,
      store.beginRun(),
      () => Promise.resolve(),
    );
    expect(report).toEqual({ parts: 2, committedParts: 2 });
    await store.whenIdle();
  });

  it('restores a step of one part at once, and nothing when there is none', async () => {
    const store = new YjsDocumentStore();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    expect(history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() })).toBe(
      undefined,
    );
    runCommand(store, ADA, createObjectsCommand, rectangles(1), testEnvironment(3));
    const undone = history.startRestore('undo', { yieldToBrowser: () => Promise.resolve() });
    await expect(undone).resolves.toMatchObject({ parts: 1, committedParts: 1 });
    expect(store.read().objects.size).toBe(0);
    expect(
      history.startRestore('redo', { yieldToBrowser: () => Promise.resolve() }),
    ).toBeInstanceOf(Promise);
    await store.whenIdle();
  });

  it('reports a first part that failed before it committed, with nothing changed', async () => {
    const store = new YjsDocumentStore();
    const cause = new Error('apply failed');
    let calls = 0;
    const command = {
      ...createObjectsCommand,
      apply: (...args: Parameters<typeof createObjectsCommand.apply>) => {
        calls += 1;
        // The first call records the plan's writes; the second is the first part.
        if (calls === 2) throw cause;
        return createObjectsCommand.apply(...args);
      },
    };
    const started = startRun(store, ADA, command, rectangles(3), testEnvironment(4), {
      maxWrites: 2,
      yieldToBrowser: () => Promise.resolve(),
    });
    await expect(started).rejects.toBeInstanceOf(RunStoppedError);
    await expect(started).rejects.toMatchObject({
      committedParts: 0,
      cause,
      changes: { created: [], updated: [], deleted: [] },
    });
    await store.whenIdle();
    expect(store.read().objects.size).toBe(0);
  });
});
