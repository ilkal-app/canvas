import { whenStoreIdle, type DocumentStore } from '@canvas/document';
import type { PageId } from '@canvas/schema';

/**
 * Waits for no stepped run to hold the store: a write prepared asynchronously (an
 * image read off its thread, a font loaded) is made after the run, onto the board as it then is.
 *
 * @param target - The store written to, if any (none: nothing to wait for), and the page the
 *   write goes onto, if it matters.
 * @param target.store - The store.
 * @param target.pageId - The page.
 * @returns Whether the write may go ahead: false when its page is gone meanwhile. It never settles
 *   when the store is destroyed first.
 */
export async function afterStoreIdle(target: {
  readonly store?: DocumentStore | undefined;
  readonly pageId?: PageId | undefined;
}): Promise<boolean> {
  const { store, pageId } = target;
  if (store === undefined) return true;
  await new Promise<void>((resolve) => {
    whenStoreIdle(store, resolve);
  });
  return pageId === undefined || store.readPages().has(pageId);
}
