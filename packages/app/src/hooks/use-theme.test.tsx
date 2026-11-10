// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { THEME_PREFERENCE_STORAGE_KEY } from '../theme/theme-preference.js';
import { THEMES } from '../theme/theme-tokens.js';

import { useTheme, type ThemeScope } from './use-theme.js';

/**
 * Stubs `matchMedia` with a controllable `prefers-color-scheme: dark` query.
 *
 * @param isDarkAtFirst - Whether the system starts in dark mode.
 * @returns A function that switches the system's mode and notifies listeners.
 */
function stubSystemDarkMode(isDarkAtFirst: boolean): (isDark: boolean) => void {
  const list = Object.assign(new EventTarget(), { media: '', matches: isDarkAtFirst });
  vi.stubGlobal('matchMedia', () => list);
  return (isDark) => {
    Object.assign(list, { matches: isDark });
    list.dispatchEvent(new Event('change'));
  };
}

function renderTheme(initialPreference?: 'system' | 'light' | 'dark', scope?: ThemeScope) {
  const target = document.createElement('div');
  const ref = { current: target };
  const hook = renderHook(() => useTheme(ref, initialPreference, undefined, scope));
  return { target, hook };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useTheme', () => {
  it('passes a choice to every other theme on the page, as the site frame around a shell', () => {
    stubSystemDarkMode(false);
    const outer = renderTheme();
    const inner = renderTheme();
    act(() => {
      inner.hook.result.current.setPreference('dark');
    });
    expect(outer.hook.result.current.themeName).toBe('dark');
    expect(outer.target.dataset.theme).toBe('dark');
    inner.hook.unmount();
    act(() => {
      outer.hook.result.current.setPreference('light');
    });
    expect(outer.hook.result.current.themeName).toBe('light');
  });

  it('keeps a shell-scoped choice to its own shell, unshared and unkept', () => {
    stubSystemDarkMode(false);
    localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, 'dark');
    const first = renderTheme('dark', 'shell');
    const second = renderTheme('dark', 'shell');
    const page = renderTheme();
    expect(renderTheme(undefined, 'shell').hook.result.current.preference).toBe('system');
    act(() => {
      first.hook.result.current.setPreference('light');
    });
    expect(first.target.dataset.theme).toBe('light');
    expect(second.hook.result.current.themeName).toBe('dark');
    expect(page.hook.result.current.themeName).toBe('dark');
    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('dark');
    act(() => {
      page.hook.result.current.setPreference('light');
    });
    expect(second.hook.result.current.themeName).toBe('dark');
    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('light');
  });

  it('follows a new starting preference in a shell scope, not in a page one', () => {
    stubSystemDarkMode(false);
    const target = document.createElement('div');
    const ref = { current: target };
    const shell = renderHook(
      ({ preference }: { preference: 'light' | 'dark' }) =>
        useTheme(ref, preference, undefined, 'shell'),
      { initialProps: { preference: 'light' as 'light' | 'dark' } },
    );
    const page = renderHook(
      ({ preference }: { preference: 'light' | 'dark' }) => useTheme({ current: null }, preference),
      { initialProps: { preference: 'light' as 'light' | 'dark' } },
    );
    shell.rerender({ preference: 'dark' });
    page.rerender({ preference: 'dark' });
    expect(target.dataset.theme).toBe('dark');
    expect(page.result.current.preference).toBe('light');
  });

  it('starts a person with no stored preference on the system’s theme', () => {
    stubSystemDarkMode(false);
    const { hook } = renderTheme();
    expect(hook.result.current.preference).toBe('system');
    expect(hook.result.current.themeName).toBe('light');
  });

  it('follows prefers-color-scheme when the preference is system', () => {
    stubSystemDarkMode(true);
    const { hook } = renderTheme('system');
    expect(hook.result.current.preference).toBe('system');
    expect(hook.result.current.themeName).toBe('dark');
  });

  it('switches when the operating system switches', () => {
    const setSystemDark = stubSystemDarkMode(false);
    const { hook, target } = renderTheme('system');
    expect(hook.result.current.themeName).toBe('light');
    act(() => {
      setSystemDark(true);
    });
    expect(hook.result.current.themeName).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
  });

  it('falls back to Graphite when the browser cannot report a preference', () => {
    const { hook } = renderTheme('system');
    expect(hook.result.current.themeName).toBe('dark');
  });

  it('lets an explicit preference override the system', () => {
    stubSystemDarkMode(true);
    const { hook } = renderTheme('system');
    act(() => {
      hook.result.current.setPreference('light');
    });
    expect(hook.result.current.themeName).toBe('light');
  });

  it('applies the theme tokens to the target element', () => {
    const { target } = renderTheme('dark');
    expect(target.style.getPropertyValue('--color-surface-sheet')).toBe(
      THEMES.dark['--color-surface-sheet'],
    );
    expect(target.dataset.theme).toBe('dark');
  });

  it('keeps the person’s choice on this device and starts from it next time', () => {
    const first = renderTheme();
    act(() => {
      first.hook.result.current.setPreference('light');
    });
    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe('light');
    cleanup();
    const second = renderTheme();
    expect(second.hook.result.current.preference).toBe('light');
    expect(second.target.dataset.theme).toBe('light');
  });

  it('does not store a starting preference it was given', () => {
    renderTheme('light');
    expect(localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBeNull();
  });
});
