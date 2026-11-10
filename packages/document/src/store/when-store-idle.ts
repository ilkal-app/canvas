import { rootOf } from '../history/undo-groups.js';

import type { DocumentStore } from './document-store.js';
import { runsOf } from './internal.js';
import type { RunnableStore, StoreRunState } from './store-run.js';

/**
 * Does `work`, a write, once no stepped run holds the store: at once and
 * synchronously when none does, else when the store is idle, checking again if another run began
 * meanwhile; nothing when the store is destroyed first. A store that forwards its writes
 * (`forwardUndoSteps`, the app's page stores) waits on the store it writes through. Writers that
 * fire on their own (size followers, text commits, a font replacement, an image insert, a comment
 * pin) write through it, so a run's parts are never interleaved with theirs, and their work is
 * kept rather than refused with `StoreBusyError`.
 *
 * @param store - The store written to.
 * @param work - The write.
 */
export function whenStoreIdle(store: DocumentStore, work: () => void): void {
  const root = rootOf(store) as DocumentStore & Partial<RunnableStore>;
  if (root.isRunning !== true || root.whenIdle === undefined) {
    work();
    return;
  }
  root.whenIdle().then(
    () => {
      // Destroyed between the run's end and this callback: nothing to write to.
      if (runsOf(root)?.isDestroyed !== true) whenStoreIdle(root, work);
    },
    () => undefined,
  );
}

/**
 * Whether a stepped run holds the store now, resolved through forwarding page stores.
 *
 * @param store - The store, or one that forwards to it.
 * @returns `true` while a run holds its root.
 */
export function isStoreRunning(store: DocumentStore): boolean {
  return (rootOf(store) as DocumentStore & Partial<RunnableStore>).isRunning === true;
}

/**
 * Waits until no stepped run holds the store, as {@link whenStoreIdle} would do a write.
 *
 * @param store - The store, or one that forwards to it.
 * @returns Resolves `true` once idle, at once when it is; `false` when the store is destroyed first.
 */
export function waitForStoreIdle(store: DocumentStore): Promise<boolean> {
  const root = rootOf(store) as DocumentStore & Partial<RunnableStore>;
  if (root.isRunning !== true || root.whenIdle === undefined) return Promise.resolve(true);
  return root.whenIdle().then(
    () => (runsOf(root)?.isDestroyed === true ? false : waitForStoreIdle(root)),
    () => false,
  );
}

/**
 * Follows the runs of a store's root: told when one opens, on each progress report
 * (`StoreRun.progress`), and when it closes; not at once (read `storeRunState` right after). A
 * store with no runs never tells; nothing after the store is destroyed.
 *
 * @param store - The store, or a page store forwarding to its board.
 * @param listener - Told the run's state, or `undefined` once it closed.
 * @returns A function that stops following.
 */
export function subscribeStoreRuns(
  store: DocumentStore,
  listener: (state: StoreRunState | undefined) => void,
): () => void {
  return runsOf(rootOf(store))?.subscribe(listener) ?? (() => undefined);
}

/**
 * The run open on a store's root now, with its last reported progress.
 *
 * @param store - The store, or a page store forwarding to its board.
 * @returns The state, or `undefined` while none is open or for a store with no runs.
 */
export function storeRunState(store: DocumentStore): StoreRunState | undefined {
  return runsOf(rootOf(store))?.state;
}
