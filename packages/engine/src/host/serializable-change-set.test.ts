import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';

import { isSerializableChangeSet, serializeChangeSet } from './serializable-change-set.js';

const id = (value: string): ObjectId => value as ObjectId;

describe('serializeChangeSet', () => {
  it('copies the id lists and the touched objects as they are now', () => {
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b'));
    document.takeChanges();
    document.create(shapeObject('c'));
    document.update('a', { x: 5 });
    document.delete('b');
    const serialized = serializeChangeSet(document.takeChanges());
    expect(serialized.created).toEqual(['c']);
    expect(serialized.updated).toEqual(['a']);
    expect(serialized.deleted).toEqual(['b']);
    expect(Object.keys(serialized.objects).sort()).toEqual(['a', 'c']);
    expect(serialized.objects.a).toMatchObject({ id: 'a', x: 5 });
  });

  it('adds the ancestors of a touched object, which its world transform needs', () => {
    const document = new FakeSceneDocument();
    document.create(
      frameObject('outer', { x: 10 }),
      groupObject('inner', { parentId: 'outer' }),
      shapeObject('leaf', { parentId: 'inner' }),
    );
    document.takeChanges();
    document.update('leaf', { x: 1 });
    const serialized = serializeChangeSet(document.takeChanges());
    expect(serialized.updated).toEqual(['leaf']);
    expect(Object.keys(serialized.objects).sort()).toEqual(['inner', 'leaf', 'outer']);
  });

  it('stops at a missing parent and at a parent cycle', () => {
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('orphan', { parentId: 'gone' }),
      groupObject('p', { parentId: 'q' }),
      groupObject('q', { parentId: 'p' }),
      shapeObject('child', { parentId: 'p' }),
    );
    const serialized = serializeChangeSet(document.takeChanges());
    expect(Object.keys(serialized.objects).sort()).toEqual(['child', 'orphan', 'p', 'q']);
  });

  it('keeps an id such as __proto__ as a plain own key', () => {
    const document = new FakeSceneDocument();
    document.create(shapeObject('__proto__'));
    const serialized = serializeChangeSet(document.takeChanges());
    expect(Object.hasOwn(serialized.objects, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(serialized.objects)).toBe(Object.prototype);
  });

  it('produces plain data and leaves the change set untouched', () => {
    const changes = Object.freeze({
      created: Object.freeze([id('a')]),
      updated: Object.freeze([]),
      deleted: Object.freeze([]),
      get: (objectId: ObjectId) => (objectId === 'a' ? shapeObject('a') : undefined),
    });
    const serialized = serializeChangeSet(changes);
    expect(serialized.created).not.toBe(changes.created);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
    expect(Object.values(serialized).some((value) => typeof value === 'function')).toBe(false);
  });
});

describe('isSerializableChangeSet', () => {
  it('accepts the id lists and object map of a change set, and nothing else', () => {
    expect(isSerializableChangeSet({ created: ['a'], updated: [], deleted: [], objects: {} })).toBe(
      true,
    );
    for (const value of [
      null,
      { created: [1], updated: [], deleted: [], objects: {} },
      { created: [], updated: [], deleted: [] },
      { created: [], updated: 'a', deleted: [], objects: {} },
    ]) {
      expect(isSerializableChangeSet(value), JSON.stringify(value)).toBe(false);
    }
  });
});

it('checks compact translation values before the mirror consumes them', () => {
  const full = { created: [], updated: [], deleted: [], objects: {} };
  expect(isSerializableChangeSet({ ...full, translation: { ids: ['a'], x: 1, y: 2 } })).toBe(true);
  for (const translation of [
    null,
    2,
    {},
    { ids: [3], x: 1, y: 2 },
    { ids: ['a'], x: Infinity, y: 2 },
    { ids: ['a'], x: 1, y: NaN },
  ]) {
    expect(isSerializableChangeSet({ ...full, translation })).toBe(false);
  }
});
