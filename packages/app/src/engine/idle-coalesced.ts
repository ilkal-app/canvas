import { isStoreRunning, whenStoreIdle, type DocumentStore } from '@canvas/document';

/**
 * Wraps derived work that a change calls (the selection's overlay, the panels' view of it) so a
 * stepped run's parts do not each redo it: called at once while no run holds the
 * store; during a run, the latest call waits and runs once the run ends. The work reads the board
 * as it is then.
 *
 * @param store - The document.
 * @param work - The work.
 * @returns The wrapped work.
 */
export function idleCoalesced<Args extends unknown[]>(
  store: DocumentStore,
  work: (...args: Args) => void,
): (...args: Args) => void {
  let pending: Args | undefined;
  return (...args) => {
    if (!isStoreRunning(store)) {
      pending = undefined;
      work(...args);
      return;
    }
    const isScheduled = pending !== undefined;
    pending = args;
    if (isScheduled) return;
    whenStoreIdle(store, () => {
      const latest = pending;
      pending = undefined;
      if (latest !== undefined) work(...latest);
    });
  };
}
