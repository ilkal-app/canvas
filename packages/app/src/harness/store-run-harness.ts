import type { DocumentStore, RunnableStore, StoreRun } from '@canvas/document';

import type { CanvasHarness } from './canvas-harness.js';

/** The harness's run methods, and the release its owner calls. */
export interface StoreRunHarness extends Pick<
  CanvasHarness,
  'beginStoreRun' | 'reportStoreRunProgress' | 'endStoreRun'
> {
  /** Ends a held run: the harness goes, or the shell's board changed. */
  readonly release: () => void;
}

/**
 * The harness's hold on the shell's board: a scenario opens a stepped run on it, as a
 * large command will, reports its progress, and ends it.
 *
 * @param store - The shell's board now, or undefined without a connection.
 * @returns The harness's run methods.
 */
export function storeRunHarness(store: () => DocumentStore | undefined): StoreRunHarness {
  let run: StoreRun | undefined;
  const end = (): void => {
    run?.close();
    run = undefined;
  };
  return {
    beginStoreRun: () => {
      const board = store() as (DocumentStore & Partial<RunnableStore>) | undefined;
      if (board?.beginRun === undefined) throw new Error('The shell has no board to hold.');
      if (run !== undefined) throw new Error('The harness already holds a run on the board.');
      run = board.beginRun();
    },
    reportStoreRunProgress: (done, total) => {
      run?.progress(done, total);
    },
    endStoreRun: end,
    release: end,
  };
}
