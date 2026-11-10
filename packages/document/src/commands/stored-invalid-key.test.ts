import { describe, expect, it } from 'vitest';

import { isValidKey } from '@canvas/schema';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import { ADA, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import { sendToBackCommand } from './reorder.js';

// The schema refuses a `z` that is not a fractional-index key, but remote updates are not
// validated, so a peer that skips validation can still put one on a board. Writes validate `z`
// only when they change it (fix round 1): an object that holds such a key stays
// editable, and rewriting it for another reason (a detach, an undo's repair) never fails.
describe('an object whose stored z is not a fractional-index key', () => {
  it('is detached, keeping its key, when an object it is attached to is deleted', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'connector-flow': 'legacy' });
    const { result } = applyCommand(store, deleteObjectsCommand, { ids: ['sticky-idea'] });
    expect(result.updatedIds).toEqual(['connector-flow']);
    expect(mustGet(store, 'connector-flow')).toMatchObject({
      z: 'legacy',
      from: { kind: 'point' },
    });
  });

  it('can still be moved, keeping its key: a move does not change z', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'image-photo': 'legacy' });
    applyCommand(store, moveObjectsCommand, { moves: [{ id: 'image-photo', by: { x: 5, y: 0 } }] });
    expect(mustGet(store, 'image-photo')).toMatchObject({ z: 'legacy' });
  });

  it('gets a valid key from sendToBack', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'image-photo': 'legacy' });
    applyCommand(store, sendToBackCommand, { ids: ['image-photo'] });
    expect(isValidKey(mustGet(store, 'image-photo').z)).toBe(true);
  });

  it('is refused a new key that is not one, locally', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'image-photo': 'legacy' });
    expect(() => {
      store.transact(ADA, (transaction) => {
        transaction.patchObject(id('image-photo'), { z: 'other' });
      });
    }).toThrow(/z/);
  });
});
