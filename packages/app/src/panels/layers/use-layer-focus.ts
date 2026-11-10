import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { LAYER_ROW_HEIGHT_PX } from './layer-row-item.js';
import { scrollToShow } from './visible-rows.js';

/** The layers list's scroll position and keyboard focus. */
export interface LayerFocus {
  /** How far the list is scrolled, CSS px. */
  readonly scrollTopPx: number;
  /** The index of the row that takes keyboard focus (`tabIndex` 0), within the rows. */
  readonly target: number;
  /** Follows the list's own scrolling. */
  readonly onScroll: (scrollTopPx: number) => void;
  /** A row took focus (a click, Tab). */
  readonly onRowFocus: (index: number) => void;
  /**
   * Makes a row the focus target and, once the render that lists it is in the DOM, scrolls it
   * into view and, with `shouldFocus`, focuses it (the arrow keys).
   */
  readonly show: (index: number, shouldFocus?: boolean) => void;
  /**
   * Makes a row the focus target and scrolls it into view, as `show` does, unless the person is
   * scrolling the list (a scroll of theirs within `USER_SCROLL_QUIET_MS`): then the list stays
   * where they put it (a selection made on the canvas while they scroll).
   */
  readonly reveal: (index: number) => void;
}

/** How long after the person's last scroll of the list a reveal leaves it alone, ms. */
export const USER_SCROLL_QUIET_MS = 400;

/** A row to bring into view after the next render. */
interface ShowRequest {
  /** The row. */
  readonly index: number;
  /** Whether to focus it too. */
  readonly shouldFocus: boolean;
}

/**
 * The scroll position and roving focus of the virtualised layers list: the focus target stays
 * within the rows as they change, and a row asked for is scrolled to (and focused) in a layout
 * effect, after the render that lists it: a row just revealed in a frame expanded in the same
 * step is below the list's old end, where the browser would clamp an earlier scroll. A scroll
 * the list reports that is not the one it was just given is the person's, and a reveal does not
 * scroll while they are scrolling.
 *
 * @param listRef - The scrolling list.
 * @param heightPx - Its visible height, CSS px.
 * @param rowCount - How many rows it has.
 * @returns The scroll position, the focus target and their handlers.
 */
export function useLayerFocus(
  listRef: RefObject<HTMLElement | null>,
  heightPx: number,
  rowCount: number,
): LayerFocus {
  const [scrollTopPx, setScrollTopPx] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [request, setRequest] = useState<ShowRequest | undefined>(undefined);
  const heightRef = useRef(heightPx);
  heightRef.current = heightPx;
  const givenTopRef = useRef<number | undefined>(undefined);
  const userScrolledAtRef = useRef(Number.NEGATIVE_INFINITY);
  const target = Math.min(focusIndex, Math.max(0, rowCount - 1));
  useLayoutEffect(() => {
    const list = listRef.current;
    if (request === undefined || list === null) return;
    setRequest(undefined);
    // The list's height as laid out now: the style panel above it may have just grown with the
    // same selection, before the resize observer reports it.
    const viewHeightPx = list.clientHeight > 0 ? list.clientHeight : heightRef.current;
    const topPx = scrollToShow(request.index, list.scrollTop, viewHeightPx, LAYER_ROW_HEIGHT_PX);
    if (topPx !== list.scrollTop) {
      list.scrollTop = topPx;
      givenTopRef.current = list.scrollTop;
    }
    setScrollTopPx(list.scrollTop);
    if (request.shouldFocus) {
      list.querySelector<HTMLElement>(`[data-index="${String(request.index)}"]`)?.focus();
    }
  }, [listRef, request]);
  const show = (index: number, shouldFocus = false) => {
    setFocusIndex(index);
    setRequest({ index, shouldFocus });
  };
  const reveal = (index: number) => {
    const isUserScrolling = performance.now() - userScrolledAtRef.current < USER_SCROLL_QUIET_MS;
    if (isUserScrolling) setFocusIndex(index);
    else show(index);
  };
  const onScroll = (topPx: number) => {
    if (topPx !== givenTopRef.current) userScrolledAtRef.current = performance.now();
    givenTopRef.current = undefined;
    setScrollTopPx(topPx);
  };
  return { scrollTopPx, target, onScroll, onRowFocus: setFocusIndex, show, reveal };
}
