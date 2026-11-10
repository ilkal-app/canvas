import { describe, expect, it } from 'vitest';

import { createFixtureStore, fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { setLockedCommand } from './set-locked.js';

describe('setLocked', () => {
  it('locks objects, writing only the lock flag and the stamp', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, setLockedCommand, {
      ids: ['shape-box', 'image-photo'],
      locked: true,
    });
    expect(result).toEqual({ changedIds: ['image-photo', 'shape-box'] });
    expectDiff(before, store.read(), changes, { updated: ['image-photo', 'shape-box'] });
    expect(mustGet(store, 'shape-box')).toEqual({
      ...fixtureObject('shape-box', 'shape'),
      locked: true,
      updatedAt: NOW,
    });
    expect(mustGet(store, 'image-photo')).toEqual({
      ...fixtureObject('image-photo', 'image'),
      locked: true,
      updatedAt: NOW,
    });
  });

  it('unlocks a locked object', () => {
    const store = createFixtureStore();
    applyCommand(store, setLockedCommand, { ids: ['shape-star'], locked: false });
    expect(mustGet(store, 'shape-star')).toEqual({
      ...fixtureObject('shape-star', 'shape'),
      locked: false,
      updatedAt: NOW,
    });
  });

  it('leaves objects that already hold the value untouched', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, setLockedCommand, {
      ids: ['shape-star', 'shape-box'],
      locked: true,
    });
    expect(result).toEqual({ changedIds: ['shape-box'] });
    expectDiff(before, store.read(), changes, { updated: ['shape-box'] });
    expect(mustGet(store, 'shape-star')).toBe(
      before.objects.get(fixtureObject('shape-star', 'shape').id),
    );
  });

  it('writes nothing when every object already holds the value', () => {
    const store = createFixtureStore();
    const before = store.encodeState();
    const { result, changes } = applyCommand(store, setLockedCommand, {
      ids: ['shape-star'],
      locked: true,
    });
    expect(result).toEqual({ changedIds: [] });
    expect(changes.updated).toEqual([]);
    expect(store.encodeState()).toEqual(before);
  });

  it('rejects unknown and repeated ids, writing nothing', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, setLockedCommand, {
      ids: ['shape-box', 'nowhere', 'shape-box'],
      locked: true,
    });
    expect(errors.map(({ code, objectId, path }) => ({ code, objectId, path }))).toEqual([
      { code: 'missing-object', objectId: 'nowhere', path: ['ids', 1] },
      { code: 'duplicate-id', objectId: 'shape-box', path: ['ids', 2] },
    ]);
  });

  it('rejects malformed input, writing nothing', () => {
    const store = createFixtureStore();
    for (const input of [
      { ids: [], locked: true },
      { ids: ['shape-box'] },
      { ids: ['shape-box'], locked: 'yes' },
      { ids: ['shape-box'], locked: true, extra: 1 },
    ]) {
      const errors = expectRejected(store, setLockedCommand, input);
      expect(
        errors.every((error) => error.code === 'invalid-input'),
        JSON.stringify(input),
      ).toBe(true);
    }
  });
});
