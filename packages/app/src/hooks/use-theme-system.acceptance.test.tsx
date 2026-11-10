// @vitest-environment jsdom
// The theme hook follows the system for a new person and keeps an explicit choice.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_PREFERENCE_STORAGE_KEY } from '../theme/theme-preference.js';

import { useTheme } from './use-theme.js';

/**
 * Installs a live dark-scheme query and returns a way to change its result.
 *
 * @param isInitiallyDark - Whether the query matches at first.
 * @returns A setter that dispatches a media-query change.
 */
function stubSystemDarkMode(isInitiallyDark: boolean): (isDark: boolean) => void {
  const query = '(prefers-color-scheme: dark)';
  const list = Object.assign(new EventTarget(), { media: query, matches: isInitiallyDark });
  vi.stubGlobal('matchMedia', (requestedQuery: string) => {
    expect(requestedQuery).toBe(query);
    return list;
  });
  return (isDark) => {
    list.matches = isDark;
    list.dispatchEvent(new Event('change'));
  };
}

/**
 * Renders the hook with a real target for its data-theme attribute.
 *
 * @returns The target and the rendered hook.
 */
function renderTheme() {
  const target = document.createElement('div');
  const hook = renderHook(() => useTheme({ current: target }));
  return { target, hook };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useTheme with the system default', () => {
  it('starts a new person in Graphite when the system is dark', () => {
    stubSystemDarkMode(true);
    const { target, hook } = renderTheme();
    expect(hook.result.current.preference).toBe('system');
    expect(hook.result.current.themeName).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
  });

  it('starts a new person in Vellum when the system is light', () => {
    stubSystemDarkMode(false);
    const { target, hook } = renderTheme();
    expect(hook.result.current.preference).toBe('system');
    expect(hook.result.current.themeName).toBe('light');
    expect(target.dataset.theme).toBe('light');
  });

  it('follows light and dark changes while the board remains open', () => {
    const setSystemDark = stubSystemDarkMode(true);
    const { target, hook } = renderTheme();
    act(() => {
      setSystemDark(false);
    });
    expect(hook.result.current.themeName).toBe('light');
    expect(target.dataset.theme).toBe('light');
    act(() => {
      setSystemDark(true);
    });
    expect(hook.result.current.themeName).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
  });

  it('keeps stored Vellum when the system is dark', () => {
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'light');
    stubSystemDarkMode(true);
    const { target, hook } = renderTheme();
    expect(hook.result.current.preference).toBe('light');
    expect(hook.result.current.themeName).toBe('light');
    expect(target.dataset.theme).toBe('light');
  });

  it('falls back to Graphite when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { target, hook } = renderTheme();
    expect(hook.result.current.preference).toBe('system');
    expect(hook.result.current.themeName).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
  });
});
