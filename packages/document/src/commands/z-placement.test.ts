import { describe, expect, it } from 'vitest';

import { isValidKey, MAX_KEY_LENGTH, type ObjectId } from '@canvas/schema';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import { createFixtureStore, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';
import { objectKeyTag } from '../z-order/object-keys.js';

import type { CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { nextZAbove, zKeysAbove } from './z-placement.js';

/**
 * A board holding one frame whose children have the given keys. Keys the schema rejects are
 * written by a remote peer, since the store refuses them locally.
 *
 * @param keys - The children's z keys.
 * @returns The store.
 */
function frameWithKeys(...keys: string[]): BoardReader {
  const store = createFixtureStore();
  const shape = fixtureObject('shape-star', 'shape');
  const invalid: Record<string, string> = {};
  store.transact({ kind: 'user', principalId: shape.createdBy }, (transaction) => {
    transaction.setObject({ ...fixtureObject('frame-plan', 'frame'), id: id('frame-keys') });
    keys.forEach((key, index) => {
      const childId = `key-${String(index)}` as ObjectId;
      if (!isValidKey(key)) invalid[childId] = key;
      transaction.setObject({
        ...shape,
        id: childId,
        parentId: id('frame-keys'),
        z: isValidKey(key) ? key : 'a0',
      });
    });
  });
  writeKeysRemotely(store, invalid);
  return store;
}

const [first, second] = [id('new-a'), id('new-b')];
const PATH = ['object'];

/**
 * Places objects above a key, expecting it to succeed.
 *
 * @param board - The board.
 * @param key - The stacking position.
 * @param excludedId - The sibling to ignore, or `null`.
 * @param ids - The objects.
 * @returns The keys.
 */
function placeAbove(
  board: BoardReader,
  key: string,
  excludedId: ObjectId | null,
  ids: readonly ObjectId[],
): string[] {
  const errors: CommandError[] = [];
  const keys = zKeysAbove(board, id('frame-keys'), key, excludedId, ids, PATH, errors);
  expect(errors).toEqual([]);
  return keys ?? [];
}

describe('z placement for commands that add objects', () => {
  it('puts a new object above every sibling, with its tag', () => {
    const errors: CommandError[] = [];
    expect(nextZAbove(frameWithKeys(), id('frame-keys'), first, PATH, errors)).toBe(
      `a0${objectKeyTag(first)}`,
    );
    const key = nextZAbove(frameWithKeys('a0', 'a3', 'a1'), id('frame-keys'), first, PATH, errors);
    expect(key).toBe(`a4${objectKeyTag(first)}`);
    expect(errors).toEqual([]);
  });

  it('reports, rather than throws, when the top key is not a fractional-index key', () => {
    const errors: CommandError[] = [];
    expect(nextZAbove(frameWithKeys('a0', 'b'), id('frame-keys'), first, PATH, errors)).toBe(
      undefined,
    );
    expect(errors).toEqual([
      expect.objectContaining({ code: 'unorderable-neighbours', objectId: first, path: PATH }),
    ]);
  });

  it('places keys in order between a key and the next sibling above it', () => {
    const keys = placeAbove(frameWithKeys('a0', 'a1', 'a2', 'b00'), 'a1', id('key-1'), [
      first,
      second,
    ]);
    expect(keys.every((key) => key > 'a1' && key < 'a2' && isValidKey(key))).toBe(true);
    expect((keys[0] ?? '') < (keys[1] ?? '')).toBe(true);
    const continued = placeAbove(frameWithKeys('a1', 'a1V'), 'a1', null, [first]);
    expect(continued.every((key) => key > 'a1' && key < 'a1V')).toBe(true);
    expect(placeAbove(frameWithKeys('b'), 'b', null, [])).toEqual([]);
  });

  it('ignores the excluded sibling, and counts up when nothing is above', () => {
    expect(placeAbove(frameWithKeys('a0', 'a1'), 'a0', id('key-1'), [first])).toEqual([
      `a1${objectKeyTag(first)}`,
    ]);
  });

  it('falls back to the top of the stack when a bound is not a fractional-index key', () => {
    expect(placeAbove(frameWithKeys('a1', 'a1~', 'a3'), 'a1', null, [first])).toEqual([
      `a4${objectKeyTag(first)}`,
    ]);
  });

  it('falls back to the top of the stack when the keys would exceed the maximum length', () => {
    const long = `a0${'z'.repeat(MAX_KEY_LENGTH - 3)}`;
    expect(placeAbove(frameWithKeys(long, 'a1'), long, null, [first])).toEqual([
      `a2${objectKeyTag(first)}`,
    ]);
  });

  it('reports when neither the gap nor the top of the stack can be used', () => {
    const errors: CommandError[] = [];
    const board = frameWithKeys('legacy', 'zzz');
    expect(zKeysAbove(board, id('frame-keys'), 'legacy', id('key-0'), [first], PATH, errors)).toBe(
      undefined,
    );
    expect(errors).toEqual([
      expect.objectContaining({ code: 'unorderable-neighbours', objectId: 'key-0', path: PATH }),
    ]);
  });
});
