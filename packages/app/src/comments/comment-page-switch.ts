// Comments and pages: the page a thread's pin is on, and a page switch closing a card
// whose pin is not on the new page.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import type { PageId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import type { Thread } from './comment-api.js';
import type { CommentData } from './comment-data-context.js';
import { threadPinPlaceOf } from './thread-pin-place.js';

/**
 * The page a thread's pin is on: the service's pin, else the document's.
 *
 * @param data - The comments, over the board.
 * @param thread - The thread.
 * @returns Its page; undefined for a thread with no pin yet.
 */
export function pinPageOf(data: CommentData, thread: Thread): PageId | undefined {
  return threadPinPlaceOf(data.connection.store.read(), thread)?.pageId;
}

/**
 * Whether the open card's pin, or its pending placement, is on a page other than `page`.
 *
 * @param data - The comments.
 * @param page - The page shown.
 * @returns True when the card would have no pin beside it.
 */
function isCardOffPage(data: CommentData, page: PageId): boolean {
  if (data.placement) return (data.placement.pageId ?? page) !== page;
  const thread = data.threads.find(({ id }) => id === data.selectedId);
  if (!thread) return false;
  const pinPage = pinPageOf(data, thread);
  return pinPage !== undefined && pinPage !== page;
}

/**
 * A switch to another page closes a card whose pin, or placement, is not on it: an
 * unanchored card over a page that does not hold its pin would say nothing about that page. Only a
 * switch closes: a thread chosen on the panel shows its page first, and while that switch waits
 * for the store its card stays open, then sits beside its pin.
 *
 * @param engine - The engine, whose pages tell of a switch.
 * @param data - The comments, whose `close` closes the card.
 */
export function usePageSwitchClosesCard(
  engine: MountedEngine | undefined,
  data: CommentData | undefined,
): void {
  const pages = engine?.pages;
  const subscribe = useCallback(
    (listener: () => void) => pages?.subscribe(listener) ?? (() => undefined),
    [pages],
  );
  const page = useSyncExternalStore(subscribe, () => pages?.current());
  // Read in the effect after the render that saw the switch, so a thread chosen with it counts.
  const latest = useRef(data);
  latest.current = data;
  const before = useRef(page);
  useEffect(() => {
    if (page === before.current) return;
    before.current = page;
    const comments = latest.current;
    if (page !== undefined && comments && isCardOffPage(comments, page)) comments.close();
  }, [page]);
}
