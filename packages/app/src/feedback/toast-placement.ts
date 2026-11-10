import { useEffect, useLayoutEffect } from 'react';

import { isEditableTarget } from '../focus/editable-target.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import type { ToastRegionStore, ToastTarget } from './toast-region-store.js';

/** The attribute a home carries while it clears a dock: its `bottom` is then set from the dock. */
export const CLEARS_DOCK_ATTRIBUTE = 'data-clears-dock';

/**
 * A home's `bottom` while it clears a dock: the dock's clearance and a spacing step
 * (`--space-3`, the gap the dock keeps from the canvas's edge).
 *
 * @param clearancePx - The dock's clearance ({@link dockClearancePx}), CSS px.
 * @returns The CSS value.
 */
export function homeBottomOf(clearancePx: number): string {
  return `calc(${String(clearancePx)}px + var(--space-3))`;
}

/**
 * How far above its container's bottom edge the dock's top edge is: what a toast stack placed
 * from that edge must clear, so it follows the dock's own offset and height rather than a
 * number of its own. Pure.
 *
 * @param containerBottomPx - The container's bottom edge, viewport px.
 * @param dockTopPx - The dock's top edge, viewport px.
 * @returns The clearance, CSS px, never negative.
 */
export function dockClearancePx(containerBottomPx: number, dockTopPx: number): number {
  return Math.max(0, containerBottomPx - dockTopPx);
}

/**
 * The bottom edge of the box an absolutely placed element is placed in: its offset parent's, or
 * the viewport's when it has none of its own.
 *
 * @param element - The element.
 * @returns The edge, viewport px.
 */
function containerBottomOf(element: HTMLElement): number {
  const parent = element.offsetParent;
  if (parent === null || parent === document.body || parent === document.documentElement) {
    return document.documentElement.clientHeight;
  }
  return parent.getBoundingClientRect().bottom;
}

/**
 * Keeps a home's toasts above the dock (item 4): while the region shows in a home and a
 * dock is registered, the home's bottom edge is a spacing step above the dock's top edge
 * ({@link homeBottomOf}), measured from the home's container and following the dock's size, the
 * container's and the window's; so a change of the dock's bottom margin or height moves the
 * toasts with it. Without a dock the home keeps its stylesheet's place. Writes the element's
 * style directly, so a change renders nothing. Main thread.
 *
 * @param target - Where the region shows.
 * @param dock - The dock, if any.
 */
export function useDockClearance(
  target: ToastTarget | undefined,
  dock: HTMLElement | undefined,
): void {
  useLayoutEffect(() => {
    const home = target?.kind === 'modal' ? undefined : target?.element;
    if (home === undefined || dock === undefined) return undefined;
    const place = (): void => {
      const clearance = dockClearancePx(containerBottomOf(home), dock.getBoundingClientRect().top);
      home.style.bottom = homeBottomOf(clearance);
      home.setAttribute(CLEARS_DOCK_ATTRIBUTE, '');
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(dock);
    if (home.offsetParent instanceof HTMLElement) observer?.observe(home.offsetParent);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
      home.style.bottom = '';
      home.removeAttribute(CLEARS_DOCK_ATTRIBUTE);
    };
  }, [target, dock]);
}

/** Open menus, listboxes and dialogs: Escape inside one is theirs. */
const ESCAPE_OWNERS = '[role="menu"], [role="listbox"], [role="dialog"]';

/**
 * Whether an Escape is the toast region's to take: not one a menu, a dialog or a field already
 * handled (`preventDefault`), not typed into text or an open menu or dialog, not composed by an
 * IME and not a held key's repeat. Pure.
 *
 * @param event - The key event.
 * @returns Whether Escape should dismiss the newest toast.
 */
export function isToastEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || isImeKey(event) || event.repeat) {
    return false;
  }
  // Inside shadow DOM (an embedded SDK), `target` is the host; the path starts at the element.
  const target = event.composedPath()[0] ?? event.target;
  if (isEditableTarget(target)) return false;
  return !(target instanceof Element && target.closest(ESCAPE_OWNERS) !== null);
}

/**
 * Escape dismisses the newest toast that can be dismissed (item 5), from anywhere on the
 * page, after every component had its say: it listens on the document, which a key reaches after
 * React's handlers (a menu's, the dialog's, the text bar's, which take it with `preventDefault`
 * or `stopPropagation`) and before the window's canvas shortcuts. It takes nothing from them:
 * the canvas still hears the same Escape. Off while the region shows in a dialog, whose Escape
 * closes it. Main thread.
 *
 * @param store - The region.
 * @param isEnabled - Whether to listen.
 */
export function useToastEscape(store: ToastRegionStore, isEnabled: boolean): void {
  useEffect(() => {
    if (!isEnabled) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isToastEscape(event)) store.dismissNewest();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [store, isEnabled]);
}
