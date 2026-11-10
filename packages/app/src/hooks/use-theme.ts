import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

import { applyTheme } from '../theme/apply-theme.js';
import {
  applyChromeFonts,
  loadChromeFonts,
  NEUTRAL_CHROME_FONTS,
  type ChromeFontSet,
} from '../theme/chrome-fonts.js';
import {
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  type ThemePreference,
} from '../theme/theme-preference.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { canMatchMedia, useMediaQuery } from './use-media-query.js';

/** The theme in effect and the means to change it, as {@link useTheme} returns them. */
export interface ThemeControls {
  /** The theme shown now. */
  readonly themeName: ThemeName;
  /** The person's choice, which may be `system`. */
  readonly preference: ThemePreference;
  /** Changes the person's choice; a page's is kept on this device and shared (`ThemeScope`). */
  readonly setPreference: (preference: ThemePreference) => void;
}

/**
 * Whose theme a {@link useTheme} is: the page's, chosen once for every themed root on it and kept
 * on this device (the site, whose frame and shell agree), or this shell's own, neither shared nor
 * kept (an SDK board: two boards on a host's page each keep the theme they were given).
 */
export type ThemeScope = 'page' | 'shell';

/**
 * Every mounted page-scoped {@link useTheme}'s state setter: a choice made through one (the board menu's, in
 * the shell) reaches the others on the page (the site frame around the shell), so nested themed
 * roots never disagree.
 */
const mountedThemes = new Set<(preference: ThemePreference) => void>();

/**
 * Chooses the shell's theme and applies its tokens to an element (normally the shell's root).
 * Starts from the person's choice kept on this device, `system` if there is none;
 * under `system` it follows `prefers-color-scheme` and re-applies when that changes, Graphite
 * where the media query cannot be evaluated. A choice made through the returned setter is kept
 * for the next visit and taken by every other page-scoped `useTheme` on the page (the site frame
 * and the shell inside it agree), unless the theme is a shell's own (`ThemeScope`); a starting
 * preference passed in (the test harness's) is not kept.
 * Tokens are applied before paint, so the first frame is already
 * themed, and the chrome's fonts (the shell's own unless given) are added to the page
 * and set on the element.
 *
 * @param targetRef - The element whose subtree takes the theme.
 * @param initialPreference - The choice to start from; the stored one unless given.
 * @param fonts - The chrome's fonts; the shell's own, `NEUTRAL_CHROME_FONTS`, if absent.
 * @param scope - `shell` for a theme of its own, which neither reads, keeps nor shares a choice
 *   and follows `initialPreference` when it changes; `page` if absent.
 * @returns The theme in effect, the preference, and a setter for it.
 */
export function useTheme(
  targetRef: RefObject<HTMLElement | null>,
  initialPreference?: ThemePreference,
  fonts: ChromeFontSet = NEUTRAL_CHROME_FONTS,
  scope: ThemeScope = 'page',
): ThemeControls {
  const [preference, setStatePreference] = useState<ThemePreference>(
    () => initialPreference ?? (scope === 'page' ? loadThemePreference() : 'system'),
  );
  const setPreference = useCallback(
    (next: ThemePreference) => {
      setStatePreference(next);
      if (scope === 'shell') return;
      saveThemePreference(next);
      for (const setMounted of mountedThemes) setMounted(next);
    },
    [scope],
  );
  // A shell-scoped theme follows its starting preference when the host changes it (
  // the SDK's live theme); a page's starts from it only.
  useEffect(() => {
    if (scope === 'shell' && initialPreference !== undefined) setStatePreference(initialPreference);
  }, [scope, initialPreference]);
  useEffect(() => {
    if (scope === 'shell') return undefined;
    mountedThemes.add(setStatePreference);
    return () => {
      mountedThemes.delete(setStatePreference);
    };
  }, [scope]);
  const isSystemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const themeName = resolveTheme(preference, canMatchMedia() ? isSystemDark : undefined);
  useLayoutEffect(() => {
    loadChromeFonts(fonts);
  }, [fonts]);
  useLayoutEffect(() => {
    if (targetRef.current === null) return;
    applyTheme(targetRef.current, themeName);
    applyChromeFonts(targetRef.current, fonts);
  }, [targetRef, themeName, fonts]);
  return { themeName, preference, setPreference };
}
