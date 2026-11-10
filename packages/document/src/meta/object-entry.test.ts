import { describe, expect, it } from 'vitest';

import { isObjectEntry } from './object-entry.js';

// The one rule of what counts as an object entry, shared by the store's guard and the relay's
// stamp check (fix round 2).

describe('isObjectEntry', () => {
  it('counts any live item under a key of objects, whatever it holds', () => {
    expect(isObjectEntry({ isUnderObjects: true, key: 'p', isDeleted: false })).toBe(true);
  });

  it('does not count a deleted item, one without a key, or one elsewhere', () => {
    expect(isObjectEntry({ isUnderObjects: true, key: 'p', isDeleted: true })).toBe(false);
    expect(isObjectEntry({ isUnderObjects: true, key: undefined, isDeleted: false })).toBe(false);
    expect(isObjectEntry({ isUnderObjects: false, key: 'p', isDeleted: false })).toBe(false);
  });
});
