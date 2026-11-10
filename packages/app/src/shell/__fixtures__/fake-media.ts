import type { MatchMedia } from '../mobile-site.js';

/**
 * A viewport whose width a test sets, answering media queries of `(width < Npx)`, the system's
 * scheme (`(prefers-color-scheme: dark)`, which the site frame's theme asks) as light, and
 * reduced motion (which the loading screen asks) as not.
 */
export interface FakeViewport {
  /** Answers a query as `window.matchMedia` does. */
  readonly matchMedia: MatchMedia;
  /** Sets the width and tells the queries' listeners whose answer changed. */
  readonly resize: (width: number) => void;
}

/**
 * A viewport of a given width for `useIsMobileSite` and `window.matchMedia`.
 *
 * @param initialWidth - Its width in CSS pixels.
 * @returns The viewport.
 * @throws {Error} When asked a query it cannot answer.
 */
export function fakeViewport(initialWidth: number): FakeViewport {
  let width = initialWidth;
  const listeners = new Set<{ readonly limit: number; readonly listener: () => void }>();
  const limitOf = (query: string): number => {
    const limit = /^\(width < (\d+)px\)$/.exec(query)?.[1];
    if (limit === undefined) throw new Error(`Cannot answer ${query}`);
    return Number(limit);
  };
  const matchMedia: MatchMedia = (query) => {
    // The site frame's theme asks the system's scheme (the home page is in the frame),
    // and the loading screen whether motion is reduced: both no.
    const isSystemQuery =
      query === '(prefers-color-scheme: dark)' || query === '(prefers-reduced-motion: reduce)';
    const limit = isSystemQuery ? 0 : limitOf(query);
    // A list answers as the viewport is when asked, as the hook asks again on each change.
    return {
      matches: width < limit,
      media: query,
      onchange: null,
      addEventListener: (...[, listener]: [string, () => void]) => {
        listeners.add({ limit, listener });
      },
      removeEventListener: (...[, listener]: [string, () => void]) => {
        for (const entry of listeners) if (entry.listener === listener) listeners.delete(entry);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };
  return {
    matchMedia,
    resize: (next) => {
      const before = width;
      width = next;
      for (const { limit, listener } of [...listeners]) {
        if (before < limit !== next < limit) listener();
      }
    },
  };
}
