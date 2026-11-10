import { useEffect, useState, type RefObject } from 'react';

/**
 * An element's height, CSS px, kept up to date with a `ResizeObserver`; `fallbackPx` before it
 * is measured, where the browser has no observer (jsdom), or while it measures 0 (not laid out).
 *
 * @param ref - The element.
 * @param fallbackPx - The height to assume until a real one is known, CSS px.
 * @returns The height, CSS px.
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>, fallbackPx: number): number {
  const [heightPx, setHeightPx] = useState(fallbackPx);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.height ?? 0;
      setHeightPx(measured > 0 ? measured : fallbackPx);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, fallbackPx]);
  return heightPx;
}
