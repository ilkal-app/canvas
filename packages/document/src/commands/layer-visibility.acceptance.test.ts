// Stored visibility is an optional layer style, absent means shown.
import { describe, expect, it } from 'vitest';

import {
  importBoard,
  LAYER_VISIBILITY_VERSION,
  SCHEMA_VERSION,
  type ObjectType,
} from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';
import { ADA_ID, createClientPair } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import {
  BOB,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { createObjectsCommand } from './create-objects.js';
import { setStyleCommand } from './set-style.js';

const LAYERS = [
  ['shape', 'shape-box'],
  ['text', 'text-title'],
  ['sticky', 'sticky-idea'],
  ['line', 'line-divider'],
  ['connector', 'connector-flow'],
  ['path', 'path-squiggle'],
  ['group', 'group-diagram'],
  ['frame', 'frame-plan'],
  ['image', 'image-photo'],
  ['video', 'video-demo'],
] as const;

function newLayer(type: ObjectType, sourceId: string): Record<string, unknown> {
  const entry = {
    ...fixtureObject(sourceId, type),
    id: `hidden-${type}`,
    parentId: null,
    x: 240,
    y: 180,
    isHidden: true,
  } as Record<string, unknown>;
  for (const key of ['z', 'locked', 'createdBy', 'createdAt', 'updatedAt', 'pageId', 'rotation'])
    Reflect.deleteProperty(entry, key);
  return entry;
}

describe('stored layer visibility', () => {
  it('uses schema version 24 or later', () => {
    expect(LAYER_VISIBILITY_VERSION).toBe(24);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(LAYER_VISIBILITY_VERSION);
  });

  it.each(LAYERS)('createObject stores and reads hidden %s', (type, sourceId) => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectCommand, {
      object: newLayer(type, sourceId),
    } as never);
    expect(store.get(result.id)).toMatchObject({ type, isHidden: true });
    store.destroy();
  });

  it.each(['component', 'instance'] as const)('createObject stores hidden %s', (type) => {
    const store = createFixtureStore();
    const board = importBoard(createFixtureBoardJson(true));
    const main = board.objects.get(id('component-card'));
    const source = board.objects.get(id(`${type}-card`));
    if (main?.type !== 'component' || source?.type !== type)
      throw new Error('missing component fixtures');
    if (type === 'instance') {
      store.transact(BOB, (transaction) => {
        transaction.setObject(main);
      });
    }
    const entry = { ...source, id: `hidden-${type}`, isHidden: true } as Record<string, unknown>;
    for (const key of ['z', 'locked', 'createdBy', 'createdAt', 'updatedAt', 'pageId', 'rotation'])
      Reflect.deleteProperty(entry, key);
    const { result } = applyCommand(store, createObjectCommand, { object: entry } as never);
    expect(store.get(result.id)).toMatchObject({ type, isHidden: true });
    store.destroy();
  });

  it('createObjects stores and reads hidden entries', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [newLayer('shape', 'shape-box'), newLayer('frame', 'frame-plan')],
    } as never);
    expect(result.ids).toHaveLength(2);
    for (const created of result.ids) expect(store.get(created)).toMatchObject({ isHidden: true });
    store.destroy();
  });

  it.each(LAYERS)('setStyle hides and shows %s, and undo restores hidden', (type, sourceId) => {
    const [store] = createClientPair(100, 200);
    const history = createHistory(store, ADA_ID);
    const target = id(sourceId);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: target, style: { isHidden: true } }],
    });
    expect(store.get(target)).toMatchObject({ isHidden: true });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: target, style: { isHidden: false } }],
    });
    expect(store.get(target)).toMatchObject({ isHidden: false });
    expect(history.undo()).toBe(true);
    expect(store.get(target)).toMatchObject({ isHidden: true });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: target, style: { isHidden: undefined } }],
    });
    expect(store.get(target)).not.toHaveProperty('isHidden');
    store.destroy();
  });

  it.each(['component', 'instance'] as const)('setStyle stores visibility on %s', (type) => {
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
    applyCommand(store, setStyleCommand, {
      changes: [{ id: target, style: { isHidden: true } }],
    });
    expect(store.get(target)).toMatchObject({ isHidden: true });
    store.destroy();
  });

  it('refuses isHidden on a comment', () => {
    const store = createFixtureStore();
    expectRejected(store, setStyleCommand, {
      changes: [{ id: id('comment-free'), style: { isHidden: true } }],
    });
    store.destroy();
  });
});
