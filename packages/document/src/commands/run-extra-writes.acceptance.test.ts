import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import {
  type Command,
  createHistory,
  createObjectCommand,
  moveObjectsCommand,
  placeObjectsCommand,
  runCommand,
  setAutoLayoutCommand,
  startRun,
  YjsDocumentStore,
} from '@canvas/document';
import { validateBoard, type BoardObject } from '@canvas/schema';

import { box, frame, ROW, storeWith } from '../layout/__fixtures__/auto-layout-fixtures.js';
import { hostileUpdate } from '../repair/__fixtures__/cycle-fixtures.js';
import { ADA, RELAY, unreadableEntries } from '../store/__fixtures__/store-fixtures.js';

import { NOW, applyCommand, mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { newRectangle } from './__fixtures__/component-boards.js';

function clone(store: YjsDocumentStore): YjsDocumentStore {
  const copy = new YjsDocumentStore({ repairMode: 'read-only' });
  copy.applyUpdate(store.encodeState(), RELAY);
  return copy;
}

function objects(store: YjsDocumentStore): [string, BoardObject][] {
  return [...store.read().objects].sort(([first], [second]) => first.localeCompare(second));
}

async function replay<InputSchema extends z.ZodType, Plan, Result>(
  store: YjsDocumentStore,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  maxWrites: number,
) {
  const peer = clone(store);
  const twin = clone(store);
  const before = objects(store);
  const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
  const partChanges: {
    created: number;
    updated: number;
    deleted: number;
    createdIds: readonly string[];
    updatedIds: readonly string[];
  }[] = [];
  const stopChanges = store.subscribe((changes) => {
    partChanges.push({
      created: changes.created.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
      createdIds: changes.created,
      updatedIds: changes.updated,
    });
  });
  const stopUpdates = store.subscribeUpdates(({ update }) => {
    peer.applyUpdate(update, RELAY);
    expect(unreadableEntries(peer)).toEqual([]);
    expect(validateBoard(peer.read())).toEqual([]);
    expect(objects(peer)).toEqual(objects(store));
  });
  const yieldToBrowser = vi.fn(() => Promise.resolve());
  const started = startRun(store, ADA, command, input, testEnvironment(), {
    maxWrites,
    yieldToBrowser,
  });
  if (!(started instanceof Promise)) throw new Error(`run refused: ${JSON.stringify(started)}`);
  const report = await started;
  stopChanges();
  stopUpdates();

  const baseline = runCommand(twin, ADA, command, input, testEnvironment());
  expect(baseline.status).toBe('applied');
  if (baseline.status !== 'applied') throw new Error('baseline command refused');
  expect(report.result).toEqual(baseline.result);
  expect(objects(store)).toEqual(objects(twin));
  expect(partChanges).toHaveLength(report.parts);
  expect(report.committedParts).toBe(report.parts);
  expect.soft(report.isOverBudget).toBe(false);
  for (const changes of partChanges) {
    const effectiveWrites = changes.created * 2 + changes.updated * 2 + changes.deleted;
    expect.soft(effectiveWrites).toBeLessThanOrEqual(maxWrites);
  }
  expect(history.undo()).toBe(true);
  expect(objects(store)).toEqual(before);
  expect(history.canUndo()).toBe(false);
  return { report, partChanges, yieldToBrowser };
}

function layoutStore(children: number): YjsDocumentStore {
  const store = storeWith(
    frame('row'),
    ...[...Array(children).keys()].map((index) =>
      box(`child-${String(index)}`, 'row', `a${String(index)}`, 30, 20),
    ),
  );
  applyCommand(store, setAutoLayoutCommand, { ids: ['row'], autoLayout: ROW });
  return store;
}

function cycleStore(): YjsDocumentStore {
  const store = new YjsDocumentStore({ repairMode: 'read-only' });
  store.transact(ADA, (transaction) => {
    for (let index = 0; index < 4; index += 1) {
      transaction.setObject({ ...frame(`a-${String(index)}`), x: index * 1000 });
      transaction.setObject({ ...frame(`b-${String(index)}`), x: index * 1000 + 450 });
    }
  });
  const writes: Record<string, { placement: { parentId: string } }> = {};
  for (let index = 0; index < 4; index += 1) {
    writes[`a-${String(index)}`] = { placement: { parentId: `b-${String(index)}` } };
    writes[`b-${String(index)}`] = { placement: { parentId: `a-${String(index)}` } };
  }
  store.applyUpdate(hostileUpdate(store, writes), RELAY);
  expect(store.read().issues.filter(({ code }) => code === 'parent-cycle')).toHaveLength(4);
  return store;
}

// The production move command does not split. Split its validated patches here so the four
// independent roots can exceed the budget while the command's own parts remain bounded.
const splitMovesCommand: typeof moveObjectsCommand = {
  ...moveObjectsCommand,
  split(plan, options) {
    if (options?.maxWrites === undefined || plan.patches.length * 2 <= options.maxWrites)
      return undefined;
    const perPart = Math.max(1, Math.floor(options.maxWrites / 2));
    const parts = [];
    for (let start = 0; start < plan.patches.length; start += perPart) {
      parts.push({
        patches: plan.patches.slice(start, start + perPart),
        reparentedIds: [],
        rerootedIds: [],
      });
    }
    return {
      parts,
      result: {
        movedIds: plan.patches.map(({ id }) => id),
        reparentedIds: plan.reparentedIds,
        rerootedIds: plan.rerootedIds,
      },
    };
  },
};

function stretchStore(): YjsDocumentStore {
  const store = storeWith(
    frame('row'),
    frame('source', null, 'a1'),
    ...['first', 'second'].map((id, index) => ({
      ...box(id, 'source', `a${String(index)}`, 30, 20),
      x: 5 + index * 40,
      y: 5,
      updatedAt: NOW + 100,
    })),
  );
  applyCommand(store, setAutoLayoutCommand, {
    ids: ['row'],
    autoLayout: { ...ROW, align: 'stretch', height: 'fixed' },
  });
  return store;
}

const splitPlacesCommand: typeof placeObjectsCommand = {
  ...placeObjectsCommand,
  split(plan) {
    if (plan.patches.length < 2) return undefined;
    return {
      parts: plan.patches.map((patch) => ({ patches: [patch], reparentedIds: [] })),
      result: {
        movedIds: plan.patches.map(({ id }) => id),
        reparentedIds: plan.reparentedIds,
      },
    };
  },
};

describe('stepped run extra writes', () => {
  it('keeps a forced placement stamp when a trailing stretch layout rewrites the child', async () => {
    const store = stretchStore();
    const twin = clone(store);
    const before = mustGet(store, 'first');
    const updates: BoardObject[] = [];
    const stop = store.subscribe((changes) => {
      if (changes.updated.includes(before.id)) updates.push(mustGet(store, before.id));
    });
    const input = { ids: ['first'], parentId: 'row' };
    const started = startRun(store, ADA, placeObjectsCommand, input, testEnvironment(), {
      maxWrites: 2,
      yieldToBrowser: () => Promise.resolve(),
    });
    if (!(started instanceof Promise)) throw new Error('placeObjects run refused');
    const report = await started;
    stop();
    const baseline = runCommand(twin, ADA, placeObjectsCommand, input, testEnvironment());
    expect(baseline.status).toBe('applied');
    expect(report.parts).toBeGreaterThan(1);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ parentId: 'row', updatedAt: NOW + 101, height: 20 });
    expect(updates[1]).toMatchObject({ height: 290 });
    expect(updates[1]).toMatchObject({
      parentId: updates[0]?.parentId,
      pageId: updates[0]?.pageId,
      x: updates[0]?.x,
      y: updates[0]?.y,
      rotation: updates[0]?.rotation,
      z: updates[0]?.z,
    });
    expect(mustGet(store, before.id)).toEqual(mustGet(twin, before.id));
    expect(mustGet(store, before.id).updatedAt).toBe(NOW + 101);
  });

  it('keeps a forced placement stamp when runCommand splits before its final layout', () => {
    const store = stretchStore();
    const twin = clone(store);
    const input = { ids: ['first', 'second'], parentId: 'row' };
    const parts: string[][] = [];
    const stop = store.subscribe((changes) => parts.push([...changes.updated]));
    const split = runCommand(store, ADA, splitPlacesCommand, input, testEnvironment());
    stop();
    const baseline = runCommand(twin, ADA, placeObjectsCommand, input, testEnvironment());
    expect(split.status).toBe('applied');
    expect(baseline.status).toBe('applied');
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('first');
    expect(parts[1]).toContain('first');
    expect(mustGet(store, 'first')).toMatchObject({ height: 290 });
    expect(objects(store)).toEqual(objects(twin));
    expect(mustGet(store, 'first').updatedAt).toBe(NOW + 101);
  });

  it('bounds trailing relayout parts and keeps every peer prefix valid in one undo step', async () => {
    const store = layoutStore(6);
    const { report, partChanges } = await replay(
      store,
      createObjectCommand,
      {
        object: { ...newRectangle('added', 'row', { x: 0, y: 0, width: 30, height: 20 }), z: 'Zz' },
      },
      4,
    );
    expect(report.parts).toBeGreaterThan(1);
    expect(partChanges[0]?.createdIds).toContain('added');
    expect(partChanges.slice(1).every(({ created, updated }) => created === 0 && updated > 0)).toBe(
      true,
    );
  });

  it('bounds leading normalization of four stored cycles in one undo step', async () => {
    const store = cycleStore();
    const { report, partChanges } = await replay(
      store,
      splitMovesCommand,
      {
        moves: [...Array(4).keys()].map((index) => ({
          id: `b-${String(index)}`,
          by: { x: 1, y: 0 },
        })),
      },
      4,
    );
    expect(report.parts).toBeGreaterThan(1);
    expect(partChanges.reduce((sum, changes) => sum + changes.updated, 0)).toBeGreaterThan(4);
    const firstCommandPart = partChanges.findIndex(({ updatedIds }) =>
      updatedIds.some((id) => id.startsWith('b-')),
    );
    expect(firstCommandPart).toBeGreaterThan(1);
    expect(
      partChanges
        .slice(0, firstCommandPart)
        .every(({ updatedIds }) => updatedIds.every((id) => id.startsWith('a-'))),
    ).toBe(true);
  });

  it('keeps a fitting relayout in one part without yielding', async () => {
    const store = layoutStore(1);
    const { report, yieldToBrowser } = await replay(
      store,
      createObjectCommand,
      {
        object: { ...newRectangle('added', 'row', { x: 0, y: 0, width: 30, height: 20 }), z: 'Zz' },
      },
      8,
    );
    expect(report.parts).toBe(1);
    expect(yieldToBrowser).not.toHaveBeenCalled();
  });
});
