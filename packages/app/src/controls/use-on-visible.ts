import { useEffect, type RefObject } from 'react';

/**
 * Calls a row's `onVisible` once it first scrolls into view, or at once without an
 * `IntersectionObserver`.
 *
 * @param ref - The row.
 * @param onVisible - The callback, if any.
 */
export function useOnVisible(
  ref: RefObject<Element | null>,
  onVisible: (() => void) | undefined,
): void {
  useEffect(() => {
    const row = ref.current;
    if (onVisible === undefined || row === null) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      onVisible();
      return undefined;
    }
    const observer = new IntersectionObserver((records) => {
      if (!records.some((record) => record.isIntersecting)) return;
      observer.disconnect();
      onVisible();
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [ref, onVisible]);
}
