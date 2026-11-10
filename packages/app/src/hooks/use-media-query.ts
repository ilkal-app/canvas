import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether `window.matchMedia` exists: the DOM typings say always, but jsdom and servers lack it.
 *
 * @returns True when media queries can be evaluated.
 */
export function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Whether a CSS media query matches, re-rendering when it starts or stops matching. False where
 * the browser (or a test environment) has no `matchMedia`, and during server rendering.
 *
 * @param query - The media query, such as `(prefers-color-scheme: dark)`.
 * @returns Whether the query matches now.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!canMatchMedia()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => canMatchMedia() && window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
