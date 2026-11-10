// The site's mobile pages: below 768 px wide the sign-in page drops its card (Figma
// MS1), the home page shows its mobile layout (MS2), the share dialog a sheet (MS3) and the board
// settings a page (MS4); 768 and wider keeps the desktop pages (decided 2026-10-05). The
// stylesheets use the same query.

import { useCallback, useSyncExternalStore } from 'react';

/** The narrowest viewport, in CSS pixels, that keeps the desktop pages. */
export const DESKTOP_SITE_MIN_WIDTH = 768;

/** The media query of the site's mobile pages, as the stylesheets write it. */
export const MOBILE_SITE_QUERY = `(width < ${String(DESKTOP_SITE_MIN_WIDTH)}px)`;

/**
 * Whether a viewport this wide gets the site's mobile pages. Pure.
 *
 * @param width - The viewport's width in CSS pixels.
 * @returns True below {@link DESKTOP_SITE_MIN_WIDTH}.
 */
export function isMobileSiteWidth(width: number): boolean {
  return width < DESKTOP_SITE_MIN_WIDTH;
}

/** Answers a media query, as `window.matchMedia` does; undefined where there is none. */
export type MatchMedia = (query: string) => MediaQueryList | undefined;

/**
 * The page's `window.matchMedia`, where the platform has one.
 *
 * @param query - The query.
 * @returns Its list, or undefined.
 */
function pageMatchMedia(query: string): MediaQueryList | undefined {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia(query);
}

/**
 * Whether the site shows its mobile pages now ({@link MOBILE_SITE_QUERY}), following the
 * viewport as it changes (a phone turned, a window resized). False where the platform cannot
 * say. Main thread.
 *
 * @param matchMedia - Answers the query; the page's `window.matchMedia` when absent.
 * @returns True below 768 px wide.
 */
export function useIsMobileSite(matchMedia: MatchMedia = pageMatchMedia): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = matchMedia(MOBILE_SITE_QUERY);
      list?.addEventListener('change', onChange);
      return () => {
        list?.removeEventListener('change', onChange);
      };
    },
    [matchMedia],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(MOBILE_SITE_QUERY)?.matches === true,
    () => false,
  );
}
