import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEW_PREFERENCES,
  loadViewPreferences,
  saveViewPreferences,
  VIEW_PREFERENCES_STORAGE_KEY,
  type PreferenceStorage,
} from './view-preferences.js';

function memoryStorage(): PreferenceStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const THROWING: PreferenceStorage = {
  getItem: () => {
    throw new Error('SecurityError: storage is disabled');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('view preferences', () => {
  it('start with object snapping on, the grid (so grid snapping) off, and deletes detaching', () => {
    expect(DEFAULT_VIEW_PREFERENCES).toEqual({
      isGridVisible: false,
      isSnappingOn: true,
      shouldDeleteConnectors: false,
    });
    expect(loadViewPreferences(memoryStorage())).toEqual(DEFAULT_VIEW_PREFERENCES);
  });

  it('round-trip through storage under one key', () => {
    const storage = memoryStorage();
    const preferences = { isGridVisible: true, isSnappingOn: false, shouldDeleteConnectors: true };
    saveViewPreferences(preferences, storage);
    expect([...storage.items.keys()]).toEqual([VIEW_PREFERENCES_STORAGE_KEY]);
    expect(loadViewPreferences(storage)).toEqual(preferences);
  });

  it('fall back to the defaults field by field for stored values that are not theirs', () => {
    const storage = memoryStorage();
    storage.setItem(VIEW_PREFERENCES_STORAGE_KEY, '{"isGridVisible":"yes","isSnappingOn":true}');
    expect(loadViewPreferences(storage)).toEqual(DEFAULT_VIEW_PREFERENCES);
    // A visit before the connector preference existed keeps its other choices.
    storage.setItem(VIEW_PREFERENCES_STORAGE_KEY, '{"isGridVisible":true,"isSnappingOn":false}');
    expect(loadViewPreferences(storage)).toEqual({
      isGridVisible: true,
      isSnappingOn: false,
      shouldDeleteConnectors: false,
    });
    storage.setItem(VIEW_PREFERENCES_STORAGE_KEY, 'not json');
    expect(loadViewPreferences(storage)).toEqual(DEFAULT_VIEW_PREFERENCES);
  });

  it('survive storage that throws or is missing', () => {
    expect(loadViewPreferences(THROWING)).toEqual(DEFAULT_VIEW_PREFERENCES);
    expect(() => {
      saveViewPreferences(DEFAULT_VIEW_PREFERENCES, THROWING);
    }).not.toThrow();
    expect(loadViewPreferences(undefined)).toEqual(DEFAULT_VIEW_PREFERENCES);
  });
});
