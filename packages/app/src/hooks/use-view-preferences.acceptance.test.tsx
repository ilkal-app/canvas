// @vitest-environment jsdom
// Acceptance: the site hook and mounted floating shell share one live device preference
// through the page channel, including changes made by the existing keyboard shortcut.
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { AppShell } from '../shell/app-shell.js';
import {
  DEFAULT_VIEW_PREFERENCES,
  saveViewPreferences,
  VIEW_PREFERENCES_STORAGE_KEY,
} from '../state/view-preferences.js';

import { useViewPreferences } from './use-view-preferences.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function storedGrid(): boolean | undefined {
  const stored = localStorage.getItem(VIEW_PREFERENCES_STORAGE_KEY);
  return stored === null
    ? undefined
    : (JSON.parse(stored) as { isGridVisible: boolean }).isGridVisible;
}

describe('useViewPreferences', () => {
  it('starts from storage and follows each save on the same page', () => {
    localStorage.setItem(
      VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_VIEW_PREFERENCES, isGridVisible: true }),
    );
    const { result } = renderHook(() => useViewPreferences());
    expect(result.current.preferences.isGridVisible).toBe(true);
    act(() => {
      saveViewPreferences({ ...DEFAULT_VIEW_PREFERENCES, isSnappingOn: false });
    });
    expect(result.current.preferences).toEqual({
      ...DEFAULT_VIEW_PREFERENCES,
      isSnappingOn: false,
    });
  });

  it('requests a change through the mounted floating shell, then hears its shortcut', () => {
    const { mount, engines } = createFakeMount();
    render(<AppShell platform="mac" mountEngine={mount} />);
    const { result } = renderHook(() => useViewPreferences());
    act(() => {
      result.current.request({ isGridVisible: true });
    });
    expect(storedGrid()).toBe(true);
    expect(engines[0]?.viewPreferences.at(-1)?.isGridVisible).toBe(true);
    expect(result.current.preferences.isGridVisible).toBe(true);

    fireEvent.keyDown(document.body, { key: "'", code: 'Quote', metaKey: true });
    expect(storedGrid()).toBe(false);
    expect(result.current.preferences.isGridVisible).toBe(false);
  });
});
