import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

import { isInteractiveTarget } from '../focus/interactive-target.js';
import { isImeKey } from '../shortcuts/ime-key.js';

/** What can take focus in the popover's row. */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Puts focus back on the canvas after Escape in the popover. The canvas has the keyboard when
 * focus is on nothing of the page's own (its shortcuts listen on the window; the inspector
 * drawer's `focusCanvas` hands it back the same way). So focus goes to what had it before Tab
 * brought it in, if that was an element of the page's own; else to the shell's root where that
 * takes focus (an embedding host may make it focusable); and failing both, nowhere: the
 * popover's control lets it go.
 *
 * @param sheet - The popover's sheet.
 * @param before - What had focus before, if anything.
 */
function returnFocusToCanvas(sheet: HTMLElement, before: HTMLElement | null): void {
  const target =
    before?.isConnected === true && before !== document.body
      ? before
      : sheet.closest<HTMLElement>('[data-whiteboard-chrome]');
  target?.focus();
  const active = document.activeElement;
  if (active instanceof HTMLElement && sheet.contains(active)) active.blur();
}

/**
 * Moves focus to the popover's first item, remembering what had it so Escape can give it back.
 *
 * @param sheet - The popover's sheet.
 * @param beforeRef - Where what had focus is kept.
 * @returns Whether an item took focus.
 */
function focusFirstItem(sheet: HTMLElement, beforeRef: RefObject<HTMLElement | null>): boolean {
  const first = sheet.querySelector<HTMLElement>(FOCUSABLE);
  if (first === null) return false;
  const active = document.activeElement;
  beforeRef.current = active instanceof HTMLElement ? active : null;
  first.focus();
  return true;
}

/**
 * Where an arrow, Home or End moves focus along the popover's row: the arrows wrap at
 * the ends, as the design's toolbar does; any other key moves nothing.
 *
 * @param key - The key.
 * @param index - The control focused now.
 * @param count - How many controls there are.
 * @returns The control to focus, or undefined.
 */
function rowMove(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * Moves focus along the popover's row by an arrow, Home or End pressed on one of its controls.
 * Keys in a menu, dialog or listbox the row opened, and in a text field, are theirs.
 *
 * @param sheet - The popover's sheet.
 * @param event - The key press.
 * @returns Whether it moved focus.
 */
function moveAlongRow(sheet: HTMLElement, event: KeyboardEvent<HTMLElement>): boolean {
  const { target } = event;
  if (!(target instanceof HTMLElement) || target instanceof HTMLInputElement) return false;
  if (target.closest('[role="menu"], [role="dialog"], [role="listbox"]') !== null) return false;
  const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (item) => item.closest('[role="menu"], [role="dialog"], [role="listbox"]') === null,
  );
  const index = items.indexOf(target);
  if (index === -1) return false;
  const next = rowMove(event.key, index, items.length);
  if (next === undefined) return false;
  items[next]?.focus();
  return true;
}

/**
 * The selection popover's keys: Tab pressed on the canvas (focus on nothing that takes
 * keys of its own) while the popover shows moves focus to its first control; Escape inside it
 * gives the keyboard back to the canvas (focus on nothing, or on what had it before) and keeps
 * the selection (the key stops at the popover, so the canvas's Escape does not deselect). An open menu's Escape closes the menu first. ArrowLeft and ArrowRight move along its controls,
 * wrapping at the ends, and Home and End go to them. Main thread.
 *
 * @param sheetRef - The popover's sheet.
 * @param isShown - Whether the popover shows.
 * @param focusRequests - How many times mod+/ asked for focus here (`ShellState.popoverFocusRequests`).
 * @returns The sheet's key handler, for Escape and the arrows.
 */
export function usePopoverKeys(
  sheetRef: RefObject<HTMLElement | null>,
  isShown: boolean,
  focusRequests = 0,
): (event: KeyboardEvent<HTMLElement>) => void {
  const beforeRef = useRef<HTMLElement | null>(null);
  // Mod+/ asks the shell for focus here: a new request while the popover shows takes
  // it as Tab would; the count when the popover mounts is not a request.
  const seenRequestsRef = useRef(focusRequests);
  useEffect(() => {
    if (focusRequests === seenRequestsRef.current) return;
    seenRequestsRef.current = focusRequests;
    const sheet = sheetRef.current;
    if (!isShown || sheet === null || sheet.dataset.hidden !== undefined) return;
    focusFirstItem(sheet, beforeRef);
  }, [sheetRef, isShown, focusRequests]);
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const sheet = sheetRef.current;
      if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
        return;
      if (sheet === null || event.defaultPrevented || sheet.dataset.hidden !== undefined) return;
      if (isInteractiveTarget(event.target)) return;
      if (focusFirstItem(sheet, beforeRef)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sheetRef, isShown]);
  return (event) => {
    const sheet = sheetRef.current;
    if (event.defaultPrevented || sheet === null) return;
    if (moveAlongRow(sheet, event)) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape' || isImeKey(event.nativeEvent)) return;
    event.preventDefault();
    event.stopPropagation();
    returnFocusToCanvas(sheet, beforeRef.current);
  };
}
