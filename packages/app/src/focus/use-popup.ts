import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { isImeKey } from '../shortcuts/ime-key.js';

import { nextRovingIndex } from './roving-index.js';

/** The attribute that marks a popup's items, which the arrow keys move between. */
export const POPUP_ITEM_ATTRIBUTE = 'data-popup-item';

/** Which item takes focus when a popup opens. */
type OpenFocus = 'first' | 'last';

/** A popup opened from a button, as {@link usePopup} gives it. */
export interface PopupControl {
  /** Whether the popup is open. */
  readonly isOpen: boolean;
  /** The button that opens it; focus returns here when the popup closes by key. */
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  /** The popup's element, whose items carry {@link POPUP_ITEM_ATTRIBUTE}. */
  readonly popupRef: RefObject<HTMLDivElement | null>;
  /** Opens or closes it from a click on the button. */
  readonly toggle: () => void;
  /** Closes it and puts focus back on the button. */
  readonly close: () => void;
  /** The button's keys: Arrow Down opens on the first item, Arrow Up on the last. */
  readonly onTriggerKeyDown: (event: KeyboardEvent) => void;
  /** The popup's keys: the arrows, Home and End move; Escape closes; Tab closes and moves on. */
  readonly onPopupKeyDown: (event: KeyboardEvent) => void;
}

/**
 * The items of a popup, in document order.
 *
 * @param popup - The popup.
 * @returns Its items.
 */
function itemsOf(popup: HTMLElement | null): HTMLElement[] {
  return popup === null
    ? []
    : [...popup.querySelectorAll<HTMLElement>(`[${POPUP_ITEM_ATTRIBUTE}]`)];
}

/**
 * Closes the popup on a press outside it and its button, leaving focus where the press put it.
 *
 * @param isOpen - Whether the popup is open.
 * @param refs - The button and the popup.
 * @param refs.triggerRef - The button.
 * @param refs.popupRef - The popup.
 * @param setOpen - Sets whether it is open.
 */
function useCloseOnOutsidePress(
  isOpen: boolean,
  refs: Pick<PopupControl, 'triggerRef' | 'popupRef'>,
  setOpen: (isOpen: boolean) => void,
): void {
  const { triggerRef, popupRef } = refs;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOpen, triggerRef, popupRef, setOpen]);
}

/**
 * A popup (a menu, a list) opened from a button, operable by keyboard as WAI-ARIA's menu button
 * pattern asks: the button opens it with a click, Enter, Space or Arrow Down (focus on the first
 * item) or Arrow Up (the last); inside, the arrows, Home and End move between the items marked
 * with {@link POPUP_ITEM_ATTRIBUTE}, wrapping; Escape closes it with focus back on the button;
 * Tab closes it and lets focus move on; a press outside closes it. Keys it handles are not
 * passed on, so the canvas's shortcuts never see them. Main thread.
 *
 * @returns The popup's state, refs and handlers.
 */
export function usePopup(): PopupControl {
  const [isOpen, setOpen] = useState(false);
  const [openFocus, setOpenFocus] = useState<OpenFocus>('first');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  useCloseOnOutsidePress(isOpen, { triggerRef, popupRef }, setOpen);
  useEffect(() => {
    if (!isOpen) return;
    const items = itemsOf(popupRef.current);
    (openFocus === 'first' ? items[0] : items.at(-1))?.focus();
  }, [isOpen, openFocus]);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => {
    setOpenFocus('first');
    setOpen((wasOpen) => !wasOpen);
  }, []);
  const onTriggerKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpenFocus(event.key === 'ArrowDown' ? 'first' : 'last');
    setOpen(true);
  }, []);
  const onPopupKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        setOpen(false);
        return;
      }
      if (event.key === 'Escape' && !isImeKey(event.nativeEvent)) {
        event.preventDefault();
        close();
        return;
      }
      const items = itemsOf(popupRef.current);
      const focused = items.findIndex((item) => item === document.activeElement);
      const next = nextRovingIndex(event.key, Math.max(0, focused), items.length);
      if (next === undefined || items.length === 0) return;
      event.preventDefault();
      items[next]?.focus();
    },
    [close],
  );
  return { isOpen, triggerRef, popupRef, toggle, close, onTriggerKeyDown, onPopupKeyDown };
}
