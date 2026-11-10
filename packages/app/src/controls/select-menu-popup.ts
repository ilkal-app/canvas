import { useEffect, useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';

// Where a `SelectMenu`'s list sits and when it closes on its own (split from
// select-menu.tsx). Package-internal.

/** Space between the control and its menu, px. */
const MENU_GAP_PX = 4;

/** Room the menu needs below the control before it opens upward instead, px. */
const MENU_ROOM_PX = 200;

/**
 * Where the open menu sits: fixed under the control's right edge, or over it when the window
 * has no room below, so the dialog's scrolling body never clips it.
 *
 * @param control - The control.
 * @returns The menu's position.
 */
export function menuPosition(control: HTMLElement): CSSProperties {
  const box = control.getBoundingClientRect();
  const right = Math.max(window.innerWidth - box.right, 0);
  if (box.bottom + MENU_ROOM_PX > window.innerHeight && box.top > MENU_ROOM_PX) {
    return { right, bottom: window.innerHeight - box.top + MENU_GAP_PX };
  }
  return { right, top: box.bottom + MENU_GAP_PX };
}

/**
 * Closes an open menu on a press outside it, a resize, and a scroll that moves the control from
 * under it; scroll anchoring, which leaves it in place, keeps the menu open.
 *
 * @param isOpen - Whether the menu is open.
 * @param wrapperRef - The control and its menu.
 * @param close - Closes the menu.
 */
export function useCloseOutside(
  isOpen: boolean,
  wrapperRef: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!isOpen) return undefined;
    const placedAt = wrapperRef.current?.getBoundingClientRect();
    const onPointer = (event: Event): void => {
      if (!(event.target instanceof Node) || wrapperRef.current?.contains(event.target) !== true) {
        closeRef.current();
      }
    };
    // A resize closes it: the list's offsets are the old viewport's.
    const onResize = (): void => {
      closeRef.current();
    };
    const onMove = (event: Event): void => {
      if (event.target instanceof Node && wrapperRef.current?.contains(event.target) === true) {
        return;
      }
      const now = wrapperRef.current?.getBoundingClientRect();
      const isInPlace =
        placedAt !== undefined &&
        now !== undefined &&
        Math.abs(now.left - placedAt.left) < 1 &&
        Math.abs(now.top - placedAt.top) < 1;
      if (!isInPlace) closeRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [isOpen, wrapperRef]);
}
