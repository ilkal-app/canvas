import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

/** The attribute that marks a toolbar's items for {@link useRovingFocus}. */
export const ROVING_ITEM_ATTRIBUTE = 'data-dock-item';

/** What {@link useRovingFocus} binds on the toolbar. */
export interface RovingFocus {
  /** The toolbar's `onKeyDown`: the arrows, Home and End move focus among its items. */
  readonly onKeyDown: (event: KeyboardEvent) => void;
  /** The toolbar's `onFocus`: the item focused becomes the toolbar's one tab stop. */
  readonly onFocus: (event: FocusEvent) => void;
}

/**
 * The toolbar's items, in order: the elements marked with {@link ROVING_ITEM_ATTRIBUTE}.
 *
 * @param toolbar - The toolbar.
 * @returns Its items.
 */
function itemsOf(toolbar: HTMLElement): HTMLElement[] {
  return [...toolbar.querySelectorAll<HTMLElement>(`[${ROVING_ITEM_ATTRIBUTE}]`)];
}

/**
 * Makes one item the toolbar's tab stop (`tabindex="0"`), every other `-1`.
 *
 * @param items - The toolbar's items.
 * @param stop - The one to keep in the tab order.
 */
function makeTabStop(items: readonly HTMLElement[], stop: HTMLElement): void {
  for (const item of items) item.tabIndex = item === stop ? 0 : -1;
}

/**
 * Where a key moves focus along a horizontal toolbar: the arrows stop at the ends, Home and End
 * go to them.
 *
 * @param key - The key.
 * @param index - The item focused now.
 * @param count - How many items there are.
 * @returns The item to focus, or undefined for a key that moves nothing.
 */
function toolbarMove(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, count - 1);
    case 'ArrowLeft':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * Roving focus for a horizontal toolbar (WAI-ARIA toolbar pattern): the toolbar is one tab stop,
 * the last item focused (the first until then); ArrowLeft and ArrowRight move to the previous
 * and next item, Home and End to the ends, and those keys never reach the canvas's shortcuts
 * (which would nudge or pan). A disabled (`aria-disabled`) item stays in the order, so a
 * keyboard or screen-reader user can find it and hear why. Keys pressed inside a menu the
 * toolbar opened are the menu's.
 *
 * @param toolbarRef - The toolbar element.
 * @returns The toolbar's handlers.
 */
export function useRovingFocus(toolbarRef: RefObject<HTMLElement | null>): RovingFocus {
  const stopRef = useRef<HTMLElement | null>(null);
  // After every render: items come and go with the mode, so the stop is kept or reset.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (toolbar === null) return;
    const items = itemsOf(toolbar);
    const stop = stopRef.current;
    const kept = stop !== null && items.includes(stop) ? stop : items[0];
    if (kept === undefined) return;
    stopRef.current = kept;
    makeTabStop(items, kept);
  });
  return {
    onKeyDown: (event) => {
      const toolbar = toolbarRef.current;
      const { target } = event;
      if (toolbar === null || !(target instanceof HTMLElement)) return;
      if (!target.hasAttribute(ROVING_ITEM_ATTRIBUTE)) return;
      const items = itemsOf(toolbar);
      const next = toolbarMove(event.key, items.indexOf(target), items.length);
      if (next === undefined) return;
      event.preventDefault();
      items[next]?.focus();
    },
    onFocus: (event) => {
      const toolbar = toolbarRef.current;
      const { target } = event;
      if (toolbar === null || !(target instanceof HTMLElement)) return;
      if (!target.hasAttribute(ROVING_ITEM_ATTRIBUTE)) return;
      stopRef.current = target;
      makeTabStop(itemsOf(toolbar), target);
    },
  };
}
