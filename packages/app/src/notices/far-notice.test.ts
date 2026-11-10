import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { farObjectsNotice } from './far-notice.js';

const ids = (count: number) =>
  [...Array(count).keys()].map((index) => `o${String(index)}` as ObjectId);

describe('farObjectsNotice', () => {
  it('says how many were left where they were, without ids and without a cause, one and several', () => {
    expect(farObjectsNotice({ ids: ids(1), isEvery: false })).toBe(
      '1 object was left where it was: it is out of range of the board.',
    );
    expect(farObjectsNotice({ ids: ids(3), isEvery: false })).toBe(
      '3 objects were left where they were: they are out of range of the board.',
    );
  });

  it('says the change could not be made when every object was far', () => {
    expect(farObjectsNotice({ ids: ids(2), isEvery: true })).toBe(
      'That change could not be made: the selected objects are out of range of the board.',
    );
  });
});
