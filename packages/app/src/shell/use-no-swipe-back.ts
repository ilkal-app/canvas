import { useEffect } from 'react';

/** What the first holder found on the root and the body, to put back when the last one leaves. */
interface SwipeBackLock {
  /** How many mounted holders want swipe-back off. */
  count: number;
  /** The root's inline `overscroll-behavior-x` before the first holder set it. */
  readonly rootValue: string;
  /** The body's inline `overscroll-behavior-x` before the first holder set it. */
  readonly bodyValue: string;
}

/** One lock per document, so nested or repeated shells (a history preview) share it. */
const LOCKS = new WeakMap<Document, SwipeBackLock>();

/**
 * Turns off the browser's sideways-swipe history navigation on a document: sets
 * `overscroll-behavior-x: none` inline on its root (`html`) and `body`, and returns the release
 * that puts back what was there before. Holds are counted per document: the first sets the
 * style, the last release restores it, so a second shell mounted inside the first (the history
 * preview) neither sets it twice nor restores it early. A release called twice counts once.
 *
 * @param doc - The document whose root and body take the style.
 * @returns The release.
 */
export function holdNoSwipeBack(doc: Document): () => void {
  const body = doc.body as HTMLElement | null;
  let lock = LOCKS.get(doc);
  if (lock === undefined) {
    lock = {
      count: 0,
      rootValue: doc.documentElement.style.overscrollBehaviorX,
      bodyValue: body?.style.overscrollBehaviorX ?? '',
    };
    LOCKS.set(doc, lock);
    doc.documentElement.style.overscrollBehaviorX = 'none';
    if (body !== null) body.style.overscrollBehaviorX = 'none';
  }
  lock.count += 1;
  const held = lock;
  let isReleased = false;
  return () => {
    if (isReleased) return;
    isReleased = true;
    held.count -= 1;
    if (held.count > 0) return;
    LOCKS.delete(doc);
    doc.documentElement.style.overscrollBehaviorX = held.rootValue;
    if (body !== null) body.style.overscrollBehaviorX = held.bodyValue;
  };
}

/**
 * Keeps a two-finger sideways swipe (a Mac trackpad or Magic Mouse) from navigating the browser
 * back while a board is mounted. Chrome and Safari turn a horizontal scroll that
 * overscrolls the page into history navigation; the canvas prevents its own wheel, but a swipe
 * that starts over a self-scrolling list or at the root's edge still reaches the page. Holds
 * {@link holdNoSwipeBack} on the document from mount to unmount, so the site's other pages keep
 * the browser's swipe-back. Main thread.
 *
 * @param doc - The document; the global `document` by default.
 */
export function useNoSwipeBack(doc: Document = document): void {
  useEffect(() => holdNoSwipeBack(doc), [doc]);
}
