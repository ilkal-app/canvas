import { useSyncExternalStore } from 'react';

/** The visual viewport's measures the inset is read from (`window.visualViewport`'s). */
export interface VisualViewportBox {
  /** Its height, CSS px. */
  readonly height: number;
  /** Its top edge below the layout viewport's, CSS px. */
  readonly offsetTop: number;
}

/**
 * How much of the layout viewport's bottom the on-screen keyboard covers (MX1): the
 * layout viewport's height less the visual viewport's bottom edge, whole CSS px, never negative;
 * nothing without a visual viewport. Pure.
 *
 * @param layoutHeightPx - The layout viewport's height (`window.innerHeight`), CSS px.
 * @param viewport - The visual viewport, if the browser has one.
 * @returns The inset, CSS px.
 */
export function keyboardInsetPx(
  layoutHeightPx: number,
  viewport: VisualViewportBox | null | undefined,
): number {
  if (viewport === null || viewport === undefined) return 0;
  return Math.max(0, Math.round(layoutHeightPx - viewport.height - viewport.offsetTop));
}

/**
 * Follows the visual viewport's resizes and scrolls.
 *
 * @param onChange - Called on each.
 * @returns Stops following.
 */
function subscribe(onChange: () => void): () => void {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (viewport === null || viewport === undefined) return () => undefined;
  viewport.addEventListener('resize', onChange);
  viewport.addEventListener('scroll', onChange);
  return () => {
    viewport.removeEventListener('resize', onChange);
    viewport.removeEventListener('scroll', onChange);
  };
}

/**
 * The page's keyboard inset now ({@link keyboardInsetPx}).
 *
 * @returns The inset, CSS px.
 */
function readInset(): number {
  return keyboardInsetPx(window.innerHeight, window.visualViewport);
}

/**
 * How much of the page's bottom the on-screen keyboard covers ({@link keyboardInsetPx}),
 * following it as it opens, resizes and closes (the visual viewport's `resize` and `scroll`);
 * 0 where there is no visual viewport, and during server rendering. Main thread.
 *
 * @returns The inset, CSS px.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, readInset, () => 0);
}
