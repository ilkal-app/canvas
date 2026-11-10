import { NOTICE_DURATION_MS } from '../notices/notice.js';

import type { PageNavigation } from './page-navigator.js';

/**
 * Keeps a deleted page's Undo to its own step (review): the step on top of the person's
 * history is the deletion only until their next edit (`PageNavigation.subscribeEdits`; without it,
 * the next change of the pages), which Undo would take back in its place. That edit, while the
 * notice can still show, tells `onLater` (whose notice replaces the one with Undo); Undo after it
 * does nothing. A collaborator's change is not on the person's history and keeps Undo.
 *
 * @param navigation - The pages.
 * @param onLater - Hears the person's first edit after the deletion.
 * @returns Runs the undo it is given, if the deletion is still the step on top.
 */
export function undoWhileTopmost(
  navigation: PageNavigation,
  onLater: () => void,
): (undo: () => void) => void {
  let isTopmost = true;
  const stop = (): void => {
    isTopmost = false;
    unsubscribe();
    clearTimeout(timer);
  };
  const later = (): void => {
    if (!isTopmost) return;
    stop();
    onLater();
  };
  const unsubscribe = subscribeLaterEdits(navigation, later);
  const timer = setTimeout(stop, NOTICE_DURATION_MS);
  return (undo) => {
    if (!isTopmost) return;
    stop();
    undo();
  };
}

/**
 * Hears the person's edits after now: through `subscribeEdits`, else as changes of the pages.
 *
 * @param navigation - The pages.
 * @param listener - Called after each.
 * @returns A function that stops listening.
 */
function subscribeLaterEdits(navigation: PageNavigation, listener: () => void): () => void {
  if (navigation.subscribeEdits !== undefined) return navigation.subscribeEdits(listener);
  const after = pagesKeyOf(navigation);
  return navigation.subscribe(() => {
    if (pagesKeyOf(navigation) !== after) listener();
  });
}

/** Why a deleted page's notice lost its Undo: the person edited after it, and undo takes that first. */
export const LATER_PAGE_CHANGE_NOTICE =
  'You changed the board after the deletion. Undo steps back through those changes first.';

/**
 * The pages as a key that changes with any page change: their ids and names, in order.
 *
 * @param navigation - The pages, or undefined before an engine mounts.
 * @returns The key.
 */
function pagesKeyOf(navigation: PageNavigation | undefined): string {
  return JSON.stringify(navigation?.pages().map((page) => [page.id, page.name]) ?? []);
}
