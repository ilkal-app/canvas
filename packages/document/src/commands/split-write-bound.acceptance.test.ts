import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  afterParts,
  createLargeBoardObjects,
  type Command,
  createObjectsCommand,
  createObjectsWithTokensCommand,
  deleteObjectsCommand,
  deletePageCommand,
  detachInstanceCommand,
  duplicatePageCommand,
  restoreBoardCommand,
  type RestoreBoardPlan,
  runCommand,
  startRun,
  YjsDocumentStore,
} from '@canvas/document';

import { ADA, RELAY, unreadableEntries } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import {
  newConnectorTo,
  newFrame,
  newRectangle,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { createObjectsWithStylesCommand } from './styles/create-objects-with-styles.js';

function seed(count: number) {
  const store = new YjsDocumentStore();
  const objects = createLargeBoardObjects(count, 11);
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return { store, objects };
}

async function replay<InputSchema extends z.ZodType, Plan, Result>(
  store: YjsDocumentStore,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  maxWrites: number,
  environment = testEnvironment(),
) {
  const peer = new YjsDocumentStore();
  peer.applyUpdate(store.encodeState(), RELAY);
  const partChanges: { created: number; updated: number; deleted: number }[] = [];
  const stopChanges = store.subscribe((changes) => {
    partChanges.push({
      created: changes.created.length,
      updated: changes.updated.length,
      deleted: changes.deleted.length,
    });
  });
  const stopUpdates = store.subscribeUpdates(({ update }) => {
    peer.applyUpdate(update, RELAY);
    expect(unreadableEntries(peer)).toEqual([]);
    expect([...peer.read().objects.keys()]).toEqual([...store.read().objects.keys()]);
  });
  const started = startRun(store, ADA, command, input, environment, {
    maxWrites,
    yieldToBrowser: () => Promise.resolve(),
  });
  expect(started).toBeInstanceOf(Promise);
  if (!(started instanceof Promise)) throw new Error('expected a stepped run');
  const report = await started;
  stopChanges();
  stopUpdates();
  expect(partChanges).toHaveLength(report.parts);
  for (const changes of partChanges) {
    const effectiveWrites = changes.created * 2 + changes.updated * 2 + changes.deleted;
    expect(effectiveWrites <= maxWrites || report.isOverBudget).toBe(true);
  }
  return { report, partChanges };
}

describe('write bounded split and valid peer prefixes', () => {
  it('passes maxWrites to the command splitter', () => {
    const plan = { objects: createLargeBoardObjects(7, 5) };
    const split = createObjectsCommand.split?.(plan, { maxWrites: 4 });
    expect(split).toBeDefined();
    expect(split?.parts.every((part) => part.objects.length * 2 <= 4)).toBe(true);
    expect(split?.result.ids).toEqual(plan.objects.map((object) => object.id));
  });

  it('reports an indivisible stamped object over budget', async () => {
    const store = new YjsDocumentStore();
    const started = startRun(
      store,
      ADA,
      createObjectsCommand,
      { objects: [newRectangle('only', null, { x: 0, y: 0, width: 1, height: 1 })] },
      testEnvironment(),
      { maxWrites: 1, yieldToBrowser: () => Promise.resolve() },
    );
    if (!(started instanceof Promise)) throw new Error('expected an applied run');
    const report = await started;
    expect(report.isOverBudget).toBe(true);
    expect(report.committedParts).toBe(1);
  });

  it('counts object stamps and creates referents before their children', async () => {
    const store = new YjsDocumentStore();
    const objects = [...Array(9).keys()].map((index) =>
      (index === 0 ? newFrame : newRectangle)(
        `local-${String(index)}`,
        index === 0 ? null : 'local-0',
        {
          x: index,
          y: 0,
          width: 1,
          height: 1,
        },
      ),
    );
    const { report, partChanges } = await replay(store, createObjectsCommand, { objects }, 4);
    expect(report.parts).toBeGreaterThan(1);
    expect(partChanges.every(({ created }) => created <= 2)).toBe(true);
    const [parent] = report.result.ids;
    for (const object of store.read().objects.values()) {
      if (object.id !== parent) expect(object.parentId).toBe(parent);
    }
  });

  it('orders a 501–1,000 deletion for the chosen 500 write threshold', async () => {
    const { store, objects } = seed(750);
    const { report, partChanges } = await replay(
      store,
      deleteObjectsCommand,
      { ids: objects.map((object) => object.id) },
      500,
    );
    expect(report.parts).toBeGreaterThan(1);
    expect(partChanges.every(({ deleted }) => deleted <= 500)).toBe(true);
    expect(store.read().objects.size).toBe(0);
  });

  it('gives a large selection listener a valid snapshot after every delivered part', async () => {
    const { store, objects } = seed(750);
    const selected = new Set(objects.map((object) => object.id));
    const snapshots: number[] = [];
    const stop = afterParts(store, () => {
      const snapshot = store.read();
      expect(unreadableEntries(store)).toEqual([]);
      for (const object of snapshot.objects.values()) {
        if (object.parentId !== null) expect(snapshot.objects.has(object.parentId)).toBe(true);
      }
      for (const objectId of selected) {
        if (!snapshot.objects.has(objectId)) selected.delete(objectId);
      }
      expect([...selected].every((objectId) => snapshot.objects.has(objectId))).toBe(true);
      snapshots.push(snapshot.objects.size);
    });
    const { report } = await replay(
      store,
      deleteObjectsCommand,
      { ids: objects.map((object) => object.id) },
      500,
    );
    expect(snapshots).toHaveLength(report.parts);
    expect(selected.size).toBe(0);
    stop();
  });

  it('schedules more than 500 connector rewrites once before their first deleted target', async () => {
    const store = new YjsDocumentStore();
    const created = runCommand(
      store,
      ADA,
      createObjectsCommand,
      {
        objects: [
          newRectangle('target', null, { x: 0, y: 0, width: 20, height: 20 }),
          ...[...Array(600).keys()].map((index) =>
            newConnectorTo(`connector-${String(index)}`, 'target', { x: 25 + index, y: 25 }),
          ),
        ],
      },
      testEnvironment(),
    );
    expect(created.status).toBe('applied');
    if (created.status !== 'applied') return;
    const [target] = created.result.ids;
    if (target === undefined) throw new Error('missing target');
    const { report, partChanges } = await replay(
      store,
      deleteObjectsCommand,
      { ids: [target], connectorPolicy: 'detach' },
      500,
    );
    expect(report.parts).toBeGreaterThan(1);
    const rewritten = partChanges.reduce((sum, changes) => sum + changes.updated, 0);
    expect(rewritten).toBe(600);
    expect(rewritten).toBe(report.result.updatedIds.length);
  });

  it('charges duplicate-page creation and delete-page final page removal to their parts', async () => {
    const { store } = seed(750);
    const sourcePage = [...store.readPages().keys()][0];
    if (sourcePage === undefined) throw new Error('seeded board has no page');
    const duplicated = await replay(store, duplicatePageCommand, { pageId: sourcePage }, 500);
    expect(duplicated.report.parts).toBeGreaterThan(1);
    const copyPage = duplicated.report.result.pageId;
    expect(store.readPages().has(copyPage)).toBe(true);
    const deleted = await replay(store, deletePageCommand, { pageId: copyPage }, 500);
    expect(deleted.report.parts).toBeGreaterThan(1);
    expect(store.readPages().has(copyPage)).toBe(false);
  });

  it('materializes a retained component definition before deleting its main', async () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    placeInstance(store, mainId);
    const { report } = await replay(
      store,
      deleteObjectsCommand,
      { ids: [mainId] },
      4,
      testEnvironment(30),
    );
    expect(report.result.retiredIds).toContain(mainId);
  });

  it('charges the repeated frame write while detaching an instance', async () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const instanceId = placeInstance(store, mainId);
    const { report } = await replay(
      store,
      detachInstanceCommand,
      { id: instanceId },
      4,
      testEnvironment(30),
    );
    expect(report.parts).toBeGreaterThan(1);
    expect(store.get(instanceId)?.type).toBe('frame');
  });

  it('places token definitions no later than their first referring object', async () => {
    const store = new YjsDocumentStore();
    const objects = [...Array(4).keys()].map((index) => ({
      ...newRectangle(`token-object-${String(index)}`, null, {
        x: index * 40,
        y: 0,
        width: 20,
        height: 20,
      }),
      fill: { token: `brand-${String(index)}` },
    }));
    const tokens = [...Array(4).keys()].map((index) => ({
      name: `Brand ${String(index)}`,
      light: [1, 0, 0, 1] as [number, number, number, number],
      dark: [0, 0, 1, 1] as [number, number, number, number],
    }));
    const { report } = await replay(
      store,
      createObjectsWithTokensCommand,
      {
        objects,
        tokens,
        newTokenIds: [...Array(4).keys()].map((index) => `brand-${String(index)}`),
      },
      4,
    );
    expect(report.parts).toBeGreaterThan(1);
    expect(store.readTokens().size).toBe(4);
  });

  it('charges style definitions and referring objects in bounded parts', async () => {
    const store = new YjsDocumentStore();
    const objects = [...Array(4).keys()].map((index) => ({
      ...newRectangle(`style-object-${String(index)}`, null, {
        x: index * 40,
        y: 0,
        width: 20,
        height: 20,
      }),
      effectStyleId: `effect-${String(index)}`,
      shadow: [
        {
          x: 0,
          y: 1,
          blur: 2,
          spread: 0,
          color: [0, 0, 0, 0.2] as [number, number, number, number],
        },
      ],
    }));
    const effectStyles = [...Array(4).keys()].map((index) => ({
      name: `Effect ${String(index)}`,
      value: {
        shadows: [
          {
            x: 0,
            y: 1,
            blur: 2,
            spread: 0,
            color: [0, 0, 0, 0.2] as [number, number, number, number],
          },
        ],
      },
    }));
    const { report } = await replay(
      store,
      createObjectsWithStylesCommand,
      {
        objects,
        effectStyles,
        newEffectStyleIds: [...Array(4).keys()].map((index) => `effect-${String(index)}`),
      },
      4,
    );
    expect(report.parts).toBeGreaterThan(1);
    expect(store.readEffectStyles().size).toBe(4);
  });

  it('numbers restore-board markers over the final count of bounded parts', async () => {
    const { store } = seed(750);
    const chosen = store.encodeState();
    store.transact(ADA, (transaction) => {
      for (const object of store.read().objects.values()) transaction.deleteObject(object.id);
    });
    const { report } = await replay(store, restoreBoardCommand, { state: chosen }, 500);
    expect(report.parts).toBeGreaterThan(1);
    expect(store.read().objects.size).toBe(750);
  });

  it('counts each restore marker and numbers it after the final split', () => {
    const plan = {
      objects: createLargeBoardObjects(750, 14),
      deletedIds: [],
      marker: {
        version: 1,
        id: '00000000-0000-4000-8000-000000000001',
        part: 0,
        parts: 1,
      },
    } satisfies RestoreBoardPlan;
    const split = restoreBoardCommand.split?.(plan, { maxWrites: 500 });
    expect(split).toBeDefined();
    if (split === undefined) return;
    expect(split.parts.length).toBeGreaterThan(1);
    for (const [index, part] of split.parts.entries()) {
      expect(part.marker).toMatchObject({ part: index, parts: split.parts.length });
      expect(part.objects.length * 2 + Number(part.marker !== undefined)).toBeLessThanOrEqual(500);
    }
  });
});
