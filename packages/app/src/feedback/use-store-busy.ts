import { useEffect, useState } from 'react';

import {
  storeRunState,
  subscribeStoreRuns,
  type DocumentStore,
  type StoreRunState,
} from '@canvas/document';

/** How long a stepped run holds the store before the busy indicator shows, ms. */
export const BUSY_INDICATOR_DELAY_MS = 150;

/** What the busy indicator shows (`useStoreBusy`). */
export interface StoreBusy {
  /** Whether it shows: a run has held the store for `BUSY_INDICATOR_DELAY_MS`. */
  readonly isShown: boolean;
  /** The run's progress, 0 to 1, as last reported; undefined before any report or run. */
  readonly progress: number | undefined;
}

const IDLE: StoreBusy = { isShown: false, progress: undefined };

/**
 * The fraction of a run's parts committed.
 *
 * @param state - The run's state.
 * @returns The fraction, or undefined before a report.
 */
function progressOf(state: StoreRunState): number | undefined {
  const reported = state.progress;
  return reported === undefined || reported.total <= 0 ? undefined : reported.done / reported.total;
}

/**
 * Follows a store's stepped runs for the busy indicator: shown once a run has
 * held the store for `BUSY_INDICATOR_DELAY_MS` (a shorter one shows nothing), with its reported
 * progress, and hidden when it ends. A run already open when it mounts is timed from then.
 *
 * @param store - The board, or undefined without one (nothing ever shows).
 * @returns Whether to show the indicator, and the progress.
 */
export function useStoreBusy(store: DocumentStore | undefined): StoreBusy {
  const [busy, setBusy] = useState<StoreBusy>(IDLE);
  useEffect(() => {
    if (store === undefined) {
      setBusy(IDLE); // The board went: nothing holds it now.
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isShown = false;
    const follow = (state: StoreRunState | undefined): void => {
      if (state === undefined) {
        clearTimeout(timer);
        timer = undefined;
        isShown = false;
        setBusy(IDLE);
        return;
      }
      const progress = progressOf(state);
      setBusy({ isShown, progress });
      timer ??= setTimeout(() => {
        isShown = true;
        setBusy((shown) => ({ ...shown, isShown }));
      }, BUSY_INDICATOR_DELAY_MS);
    };
    const stop = subscribeStoreRuns(store, follow);
    follow(storeRunState(store));
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [store]);
  return busy;
}
