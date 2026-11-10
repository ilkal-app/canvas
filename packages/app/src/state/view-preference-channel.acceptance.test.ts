// Acceptance: saves publish the complete device preference, and requests reach only
// mounted subscribers. The channel has no board state or browser storage of its own.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requestViewPreferences,
  subscribeViewPreferenceRequests,
  subscribeViewPreferences,
} from './view-preference-channel.js';
import {
  DEFAULT_VIEW_PREFERENCES,
  saveViewPreferences,
  VIEW_PREFERENCES_STORAGE_KEY,
  type PreferenceStorage,
} from './view-preferences.js';

const unsubscribers: (() => void)[] = [];
afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
});

describe('view preference page channel', () => {
  it('notifies each subscriber after every save with the complete preference, then stops after unsubscribe', () => {
    const items = new Map<string, string>();
    const storage: PreferenceStorage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    };
    const first = vi.fn((preferences: typeof DEFAULT_VIEW_PREFERENCES) => {
      expect(JSON.parse(items.get(VIEW_PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual(preferences);
    });
    const second = vi.fn();
    const unsubscribeFirst = subscribeViewPreferences(first);
    unsubscribers.push(unsubscribeFirst, subscribeViewPreferences(second));
    const gridOn = { ...DEFAULT_VIEW_PREFERENCES, isGridVisible: true };
    saveViewPreferences(gridOn, storage);
    expect(first).toHaveBeenCalledExactlyOnceWith(gridOn);
    expect(second).toHaveBeenCalledExactlyOnceWith(gridOn);
    unsubscribeFirst();
    saveViewPreferences(DEFAULT_VIEW_PREFERENCES, storage);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenNthCalledWith(2, DEFAULT_VIEW_PREFERENCES);
  });

  it('delivers partial requests to mounted subscribers and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeViewPreferenceRequests(listener);
    unsubscribers.push(unsubscribe);
    requestViewPreferences({ isGridVisible: true });
    requestViewPreferences({ isSnappingOn: false });
    expect(listener.mock.calls).toEqual([[{ isGridVisible: true }], [{ isSnappingOn: false }]]);
    unsubscribe();
    requestViewPreferences({ isGridVisible: false });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
