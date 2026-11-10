import { useLayoutEffect, type RefObject } from 'react';

/** The gap between the top bars and what sits below them, CSS px (`--space-2`). */
export const BELOW_TOP_BARS_GAP_PX = 8;

/** Where an element sits below the top bars, in its container's CSS px. */
export interface BelowTopBars {
  /** The element's top. */
  readonly topPx: number;
  /** The most it may be tall and stay inside its container, with `bottomInsetPx` to spare. */
  readonly maxHeightPx: number;
}

/**
 * Where an element goes so it starts below the top bars, whatever their height (a rename form
 * makes the board-name bar taller): their
 * bottom edge plus a gap, measured from the top of the container both are positioned in. Pure.
 *
 * @param bars - The top bars' box, viewport px.
 * @param container - The shared container's box, viewport px.
 * @param bottomInsetPx - What to leave free at the container's bottom, CSS px.
 * @returns The top and the largest height that keeps the element inside the container.
 */
export function belowTopBars(
  bars: Pick<DOMRectReadOnly, 'bottom'>,
  container: Pick<DOMRectReadOnly, 'top' | 'height'>,
  bottomInsetPx: number,
): BelowTopBars {
  const topPx = Math.max(0, bars.bottom - container.top) + BELOW_TOP_BARS_GAP_PX;
  return { topPx, maxHeightPx: Math.max(0, container.height - topPx - bottomInsetPx) };
}

/**
 * Keeps an absolutely positioned element below the shell's top bars (`[data-top-bars]` in the
 * same positioned container), following their height as it changes; without top bars it keeps
 * its stylesheet's place. Writes the element's style directly, so a change renders nothing.
 *
 * @param ref - The element.
 * @param bottomInsetPx - What to leave free at the container's bottom, CSS px.
 */
export function useBelowTopBars(ref: RefObject<HTMLElement | null>, bottomInsetPx: number): void {
  useLayoutEffect(() => {
    const element = ref.current;
    const container = element?.offsetParent;
    const bars = container?.querySelector('[data-top-bars]');
    if (element === null || !(container instanceof HTMLElement)) {
      return undefined;
    }
    if (!(bars instanceof HTMLElement)) return undefined;
    const place = (): void => {
      const { topPx, maxHeightPx } = belowTopBars(
        bars.getBoundingClientRect(),
        container.getBoundingClientRect(),
        bottomInsetPx,
      );
      element.style.top = `${String(topPx)}px`;
      element.style.maxHeight = `${String(maxHeightPx)}px`;
    };
    place();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(bars);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [ref, bottomInsetPx]);
}
