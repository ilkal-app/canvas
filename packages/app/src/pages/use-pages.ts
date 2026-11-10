import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import type { Page, PageId } from '@canvas/schema';

import type { PageNavigation } from './page-navigator.js';

/** What the page list shows. */
export interface PagesState {
  /** The pages, in order. */
  readonly pages: readonly Page[];
  /** The page shown. */
  readonly current: PageId | undefined;
}

/** Nothing to show before an engine mounts. */
const NO_PAGES: PagesState = Object.freeze({ pages: Object.freeze([]), current: undefined });

/** The URL's search parameter naming the page shown. */
export const PAGE_PARAMETER = 'page';

/**
 * Follows the pages (`PageNavigation.subscribe`): the list and the page shown, the same value
 * until either changes.
 *
 * @param pages - The pages, or undefined before an engine mounts.
 * @returns The state.
 */
export function usePages(pages: PageNavigation | undefined): PagesState {
  const store = useMemo(() => {
    let last: PagesState = NO_PAGES;
    let key = '';
    return {
      subscribe: (listener: () => void) => pages?.subscribe(listener) ?? (() => undefined),
      read: (): PagesState => {
        if (pages === undefined) return NO_PAGES;
        const list = pages.pages();
        const current = pages.current();
        const next = JSON.stringify([current, list]);
        if (next !== key) {
          key = next;
          last = { pages: list, current };
        }
        return last;
      },
    };
  }, [pages]);
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}

/**
 * Keeps the page shown in the address (`?page=<id>`): shows the page the address names once the
 * pages are there (a missing or unknown id leaves the first page), then writes the page shown into
 * the address, replacing the history entry.
 *
 * The page shown is also told to `onShown` (the presence channel, so collaborators see where the
 * person is), the latest one given.
 *
 * @param pages - The pages, or undefined before an engine mounts.
 * @param current - The page shown.
 * @param onShown - Hears each page shown; nothing if absent.
 * @param isInAddress - Whether the page shown is kept in the page's address, and the one it names
 *   opened; true if absent (false for an embedded shell).
 */
export function usePageInAddress(
  pages: PageNavigation | undefined,
  current: PageId | undefined,
  onShown?: (pageId: PageId) => void,
  isInAddress = true,
): void {
  const shownRef = useRef(onShown);
  useEffect(() => {
    shownRef.current = onShown;
  });
  useEffect(() => {
    if (current !== undefined) shownRef.current?.(current);
  }, [current]);
  useEffect(() => {
    if (!isInAddress || pages === undefined || typeof location === 'undefined') return;
    const named = new URL(location.href).searchParams.get(PAGE_PARAMETER);
    if (named !== null) pages.show(named as PageId);
  }, [pages, isInAddress]);
  useEffect(() => {
    if (!isInAddress || current === undefined || typeof location === 'undefined') return;
    const url = new URL(location.href);
    if (url.searchParams.get(PAGE_PARAMETER) === current) return;
    url.searchParams.set(PAGE_PARAMETER, current);
    history.replaceState(history.state, '', url);
  }, [current, isInAddress]);
}

/**
 * Follows the page shown wherever the page list is: keeps it in the address and tells
 * `onShown` (the presence channel), while the page list itself may be closed away in the layers
 * drawer. Mount it once, where the shell always is.
 *
 * @param pages - The pages, or undefined before an engine mounts.
 * @param onShown - Hears each page shown; nothing if absent.
 * @param isInAddress - Whether the page shown is kept in the page's address; true if absent.
 */
export function usePageShown(
  pages: PageNavigation | undefined,
  onShown?: (pageId: PageId) => void,
  isInAddress = true,
): void {
  const { current } = usePages(pages);
  usePageInAddress(pages, current, onShown, isInAddress);
}
