/**
 * Whether the page is hidden, and when that changes (the Page Visibility API): the engine's
 * asset adapter pauses its polls while the page is hidden.
 */
export interface PageVisibility {
  /**
   * Whether the page is hidden now.
   *
   * @returns True while hidden.
   */
  isHidden(): boolean;
  /**
   * Listens for the page being hidden or shown.
   *
   * @param onChange - Called on each change.
   * @returns Stops listening.
   */
  listen(onChange: () => void): () => void;
}

/**
 * The page's visibility from its `document`, or undefined where there is none (tests, workers).
 *
 * @param target - The document; the page's own by default.
 * @returns The visibility, or undefined.
 */
export function documentVisibility(
  target = globalThis.document as Document | undefined,
): PageVisibility | undefined {
  if (target === undefined) return undefined;
  return {
    isHidden: () => target.visibilityState === 'hidden',
    listen: (onChange) => {
      target.addEventListener('visibilitychange', onChange);
      return () => {
        target.removeEventListener('visibilitychange', onChange);
      };
    },
  };
}
