// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { VIEW_PREFERENCES_STORAGE_KEY } from '../state/view-preferences.js';

import { useShellState } from './use-shell-state.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('useShellState', () => {
  it('starts from the stored preferences and stores nothing on mount', () => {
    localStorage.setItem(
      VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ isGridVisible: true, isSnappingOn: false }),
    );
    const { result } = renderHook(() => useShellState());
    expect(result.current[0]).toMatchObject({ isGridVisible: true, isSnappingOn: false });
    localStorage.clear();
    renderHook(() => useShellState());
    expect(localStorage.length).toBe(0);
  });

  it('stores the preferences when one changes, and only then', () => {
    const { result } = renderHook(() => useShellState());
    act(() => {
      result.current[1]({ type: 'selectTool', tool: 'pen' });
    });
    expect(localStorage.length).toBe(0);
    act(() => {
      result.current[1]({ type: 'navigate', command: 'toggleGrid' });
    });
    expect(JSON.parse(localStorage.getItem(VIEW_PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual({
      isGridVisible: true,
      isSnappingOn: true,
      shouldDeleteConnectors: false,
    });
  });
});
