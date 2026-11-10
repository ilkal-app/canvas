import { useEffect } from 'react';

import type { BoardCacheWrites } from '@canvas/collab';

/**
 * Asks the browser to confirm leaving the page: `preventDefault()` is what current browsers
 * read, and a truthy `returnValue` is what Chrome and Edge before 119 and older Safari read.
 *
 * @param event - The page's `beforeunload` event.
 */
function confirmLeaving(event: BeforeUnloadEvent): void {
  event.preventDefault();
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- older Chrome reads only this
  event.returnValue = true;
}

/**
 * Holds a reload, a close or a navigation away while the board cache still has writes pending:
 * an edit's IndexedDB transaction that has not committed when the page unloads is
 * cancelled and the edit lost, although the board says it is saved on this device. A page
 * cannot delay its unload silently, so while `writes.isPending` a `beforeunload` listener calls
 * `preventDefault()` and the browser shows its own "Leave site?" prompt; the person who waits a
 * moment (or cancels) keeps the edit. The listener is added when the cache turns busy and
 * removed the moment it is idle again, so a reload of an idle board never prompts and the page
 * stays eligible for the back/forward cache (a `beforeunload` listener can keep a page out of
 * it in some browsers).
 *
 * What browsers guarantee is little: `beforeunload` is not fired at all for a tab discarded or
 * killed, often not on mobile (a page closed from the app switcher), and a browser may skip the
 * prompt for a page the person never interacted with (Chrome requires sticky activation). The
 * prompt's wording is the browser's own. So once the page is being hidden (`visibilitychange`
 * to `hidden`, or `pagehide`), the last events a page reliably gets, the cache starts no new
 * optional work that could be cut off (`holdNewWork`: a due compaction waits); the writes
 * already requested go on, and the hold is released when the page is shown again (`pageshow`
 * from the back/forward cache, or visible again). Main thread.
 *
 * @param writes - The board cache's pending writes (`BoardConnection.cacheWrites`).
 * @param win - The window whose unload is held; the global `window` by default.
 * @returns Stops holding: removes every listener and releases the cache's hold.
 */
export function holdReloadWhileSaving(writes: BoardCacheWrites, win: Window = window): () => void {
  const doc = win.document;
  let isHoldingReload = false;
  let releaseNewWork: (() => void) | undefined;
  const followWrites = (): void => {
    if (writes.isPending === isHoldingReload) return;
    isHoldingReload = writes.isPending;
    if (isHoldingReload) win.addEventListener('beforeunload', confirmLeaving);
    else win.removeEventListener('beforeunload', confirmLeaving);
  };
  const followPage = (event: Event): void => {
    if (event.type === 'pagehide' || doc.visibilityState === 'hidden') {
      releaseNewWork ??= writes.holdNewWork();
      return;
    }
    releaseNewWork?.();
    releaseNewWork = undefined;
  };
  const stopFollowing = writes.subscribe(followWrites);
  followWrites();
  doc.addEventListener('visibilitychange', followPage);
  win.addEventListener('pagehide', followPage);
  win.addEventListener('pageshow', followPage);
  return () => {
    stopFollowing();
    doc.removeEventListener('visibilitychange', followPage);
    win.removeEventListener('pagehide', followPage);
    win.removeEventListener('pageshow', followPage);
    win.removeEventListener('beforeunload', confirmLeaving);
    releaseNewWork?.();
  };
}

/**
 * Holds a reload while the board cache has writes pending ({@link holdReloadWhileSaving}), from
 * mount to unmount; nothing for a board without a device cache. Main thread.
 *
 * @param writes - The connection's `cacheWrites`, if any.
 * @param win - The window; the global `window` by default.
 */
export function useHoldReloadWhileSaving(
  writes: BoardCacheWrites | undefined,
  win: Window = window,
): void {
  useEffect(
    () => (writes === undefined ? undefined : holdReloadWhileSaving(writes, win)),
    [writes, win],
  );
}
