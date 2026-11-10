// The layers drawer's state: the reducer's toggle, open to anyone, and the person's
// choice kept in storage.
import { describe, expect, it } from 'vitest';

import { isEditingAction } from './editing-actions.js';
import {
  LAYERS_DRAWER_STORAGE_KEY,
  loadLayersDrawerOpen,
  saveLayersDrawerOpen,
} from './layers-drawer-preference.js';
import { INITIAL_SHELL_STATE, shellReducer } from './shell-reducer.js';
import type { PreferenceStorage } from './view-preferences.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: PreferenceStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  return { storage, items };
}

const THROWING: PreferenceStorage = {
  getItem: () => {
    throw new Error('Storage is disabled.');
  },
  setItem: () => {
    throw new Error('Storage is full.');
  },
};

describe('the layers drawer in shell state', () => {
  it('starts closed and toggles open and closed, recording no canvas action', () => {
    expect(INITIAL_SHELL_STATE.isLayersDrawerOpen).toBe(false);
    const open = shellReducer(INITIAL_SHELL_STATE, { type: 'toggleLayersDrawer' });
    expect(open.isLayersDrawerOpen).toBe(true);
    expect(open.lastCanvasAction).toBeUndefined();
    expect(shellReducer(open, { type: 'toggleLayersDrawer' }).isLayersDrawerOpen).toBe(false);
  });

  it('opens for a person who cannot edit, as it is no edit', () => {
    expect(isEditingAction({ type: 'toggleLayersDrawer' })).toBe(false);
    const viewer = { ...INITIAL_SHELL_STATE, canEdit: false };
    expect(shellReducer(viewer, { type: 'toggleLayersDrawer' }).isLayersDrawerOpen).toBe(true);
  });
});

describe('loadLayersDrawerOpen and saveLayersDrawerOpen', () => {
  it('reads closed on a first visit and for anything but `open`', () => {
    expect(loadLayersDrawerOpen(memoryStorage().storage)).toBe(false);
    expect(loadLayersDrawerOpen(undefined)).toBe(false);
    for (const value of ['closed', 'true', '{"isOpen":true}', '']) {
      const { storage } = memoryStorage({ [LAYERS_DRAWER_STORAGE_KEY]: value });
      expect(loadLayersDrawerOpen(storage), value).toBe(false);
    }
  });

  it('keeps the choice under its own key and reads it back', () => {
    const { storage, items } = memoryStorage();
    saveLayersDrawerOpen(true, storage);
    expect(items.get(LAYERS_DRAWER_STORAGE_KEY)).toBe('open');
    expect(loadLayersDrawerOpen(storage)).toBe(true);
    saveLayersDrawerOpen(false, storage);
    expect(items.get(LAYERS_DRAWER_STORAGE_KEY)).toBe('closed');
    expect(loadLayersDrawerOpen(storage)).toBe(false);
    expect([...items.keys()]).toEqual([LAYERS_DRAWER_STORAGE_KEY]);
  });

  it('survives a storage that throws: closed, and nothing thrown on a save', () => {
    expect(loadLayersDrawerOpen(THROWING)).toBe(false);
    expect(() => {
      saveLayersDrawerOpen(true, THROWING);
    }).not.toThrow();
  });
});
