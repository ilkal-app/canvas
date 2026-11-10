// (layer opacity): shared layer styles and creation support opacity.
import { describe, expect, it } from 'vitest';

import { importBoard, type BoardObject } from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';
import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import {
  BOB,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { createObjectsCommand } from './create-objects.js';
import { setStyleCommand } from './set-style.js';

const SHAPE = id('shape-box');
const LAYERS = [
  ['text', 'text-title'],
  ['sticky', 'sticky-idea'],
  ['shape', 'shape-box'],
  ['line', 'line-divider'],
  ['connector', 'connector-flow'],
  ['path', 'path-squiggle'],
  ['group', 'group-diagram'],
  ['frame', 'frame-plan'],
] as const;

describe.each(ORDERS)('layer opacity style ($name)', (order) => {
  it.each(LAYERS)('sets, changes, removes, undoes and redoes %s opacity', (type, objectId) => {
    const target = id(objectId);
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, setStyleCommand, { changes: [{ id: target, style: { opacity: 0.5 } }] });
    link.deliver();
    expect(bob.get(target)).toMatchObject({ opacity: 0.5 });
    applyCommand(ada, setStyleCommand, { changes: [{ id: target, style: { opacity: 0.9 } }] });
    link.deliver();
    expect(bob.get(target)).toMatchObject({ opacity: 0.9 });
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(bob.get(target)).toMatchObject({ opacity: 0.5 });
    expect(history.redo()).toBe(true);
    link.deliver();
    expect(bob.get(target)).toMatchObject({ opacity: 0.9 });
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: target, style: { opacity: undefined } }],
    });
    link.deliver();
    expect(bob.get(target)).not.toHaveProperty('opacity');
  });

  it.each(LAYERS)('the door rejects opacity outside 0–1 on %s', (type, objectId) => {
    const store = createFixtureStore();
    for (const opacity of [-0.1, 1.1, Number.NaN]) {
      const errors = expectRejected(store, setStyleCommand, {
        changes: [{ id: id(objectId), style: { opacity } }],
      });
      expect(errors.map((error) => error.code)).not.toContain('unsupported-type');
    }
    store.destroy();
  });

  it('converges on one whole style against a concurrent fill change', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const original = fixtureObject('shape-box', 'shape').fill;
    applyCommand(ada, setStyleCommand, { changes: [{ id: SHAPE, style: { opacity: 0.5 } }] });
    const green: [number, number, number, number] = [0, 1, 0, 1];
    applyCommand(bob, setStyleCommand, { changes: [{ id: SHAPE, style: { fill: green } }] }, BOB);
    link.deliver();
    const merged = ada.get(SHAPE) as Extract<BoardObject, { type: 'shape' }>;
    expect(merged).toEqual(bob.get(SHAPE));
    expect([
      { fill: original, opacity: 0.5 },
      { fill: green, opacity: undefined },
    ]).toContainEqual({ fill: merged.fill, opacity: merged.opacity });
  });
});

describe.each(['component', 'instance'] as const)('%s opacity style', (type) => {
  it('sets, changes, removes, undoes and redoes opacity', () => {
    const store = createFixtureStore();
    const board = importBoard(createFixtureBoardJson(true));
    const main = board.objects.get(id('component-card'));
    const instance = board.objects.get(id('instance-card'));
    if (main?.type !== 'component' || instance?.type !== 'instance')
      throw new Error('missing component fixtures');
    store.transact(BOB, (transaction) => {
      transaction.setObject(main);
      transaction.setObject(instance);
    });
    const target = id(`${type}-card`);
    const history = createHistory(store, ADA_ID);
    applyCommand(store, setStyleCommand, { changes: [{ id: target, style: { opacity: 0.5 } }] });
    expect(store.get(target)).toMatchObject({ opacity: 0.5 });
    applyCommand(store, setStyleCommand, { changes: [{ id: target, style: { opacity: 0.8 } }] });
    expect(store.get(target)).toMatchObject({ opacity: 0.8 });
    expect(history.undo()).toBe(true);
    expect(store.get(target)).toMatchObject({ opacity: 0.5 });
    expect(history.redo()).toBe(true);
    expect(store.get(target)).toMatchObject({ opacity: 0.8 });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: target, style: { opacity: undefined } }],
    });
    expect(store.get(target)).not.toHaveProperty('opacity');
    store.destroy();
  });
});

describe('layer opacity createObjects', () => {
  it.each(LAYERS)('creates %s with opacity', (type, sourceId) => {
    const store = createFixtureStore();
    const source = fixtureObject(sourceId, type);
    const entry = {
      ...source,
      id: `new-${type}`,
      parentId: null,
      x: 240,
      y: 180,
      opacity: 0.5,
    } as Record<string, unknown>;
    for (const key of ['z', 'locked', 'createdBy', 'createdAt', 'updatedAt', 'pageId', 'rotation'])
      Reflect.deleteProperty(entry, key);
    const { result } = applyCommand(store, createObjectsCommand, { objects: [entry] } as never);
    const [created] = result.ids;
    if (created === undefined) throw new Error('createObjects returned no id');
    expect(store.get(created)).toMatchObject({ type, opacity: 0.5 });
    store.destroy();
  });

  it.each(['component', 'instance'] as const)('creates %s with opacity', (type) => {
    const store = createFixtureStore();
    const source = importBoard(createFixtureBoardJson(true)).objects.get(id(`${type}-card`));
    if (source?.type !== type) throw new Error(`missing ${type} fixture`);
    if (type === 'instance') {
      const main = importBoard(createFixtureBoardJson(true)).objects.get(id('component-card'));
      if (main?.type !== 'component') throw new Error('missing main fixture');
      store.transact(BOB, (transaction) => {
        transaction.setObject(main);
      });
    }
    const entry = { ...source, id: `new-${type}`, opacity: 0.5 } as Record<string, unknown>;
    for (const key of ['z', 'locked', 'createdBy', 'createdAt', 'updatedAt', 'pageId', 'rotation'])
      Reflect.deleteProperty(entry, key);
    const { result } = applyCommand(store, createObjectsCommand, { objects: [entry] } as never);
    const [created] = result.ids;
    if (created === undefined) throw new Error('createObjects returned no id');
    expect(store.get(created)).toMatchObject({ type, opacity: 0.5 });
    store.destroy();
  });

  it('creates a translucent shape and keeps opacity on unrelated style writes', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        {
          type: 'shape',
          id: 'translucent',
          x: 200,
          y: 100,
          width: 100,
          height: 80,
          kind: 'ellipse',
          fill: [1, 0, 0, 1],
          stroke: null,
          cornerRadius: 0,
          sides: 4,
          label: null,
          opacity: 0.5,
        },
      ],
    });
    const created = result.ids[0];
    if (created === undefined) throw new Error('createObjects returned no id');
    expect(store.get(created)).toMatchObject({ opacity: 0.5 });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: created, style: { fill: [0, 1, 0, 1] } }],
    });
    expect(store.get(created)).toMatchObject({ opacity: 0.5 });
    store.destroy();
  });
});
