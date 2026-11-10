import type * as Y from 'yjs';

import type { StoreInternals } from '../store/internal.js';
import type { StoreBusyError } from '../store/store-run.js';

import type { UndoGroups } from './undo-groups.js';
import type { RestoreReport, UndoHistory } from './undo-history.js';

/** What a history hands {@link startSteppedRestore}. */
export interface SteppedRestoreHost {
  /** The store's internals: its run gate. */
  readonly internals: StoreInternals;
  /** The history's undo manager. */
  readonly manager: Y.UndoManager;
  /** The history's groups. */
  readonly groups: UndoGroups;
  /** Undo or redo. */
  readonly direction: 'undo' | 'redo';
  /** Lets the browser run between two parts. */
  readonly yieldToBrowser: () => Promise<void>;
  /** Forgets the last restore's omission and protection. */
  readonly clearLast: () => void;
  /** Restores the newest step, in one transaction, without telling the subscribers. */
  readonly restoreOne: () => boolean;
  /** Tells the history's subscribers. */
  readonly notify: () => void;
  /** The history, which reports what the restore omitted and protected once it ended. */
  readonly history: Pick<UndoHistory, 'lastOmission' | 'lastProtection' | 'lastOmittedObjects'>;
}

/**
 * Starts a history's stepped undo or redo (`UndoHistory.startRestore`): refuses
 * while a run holds the store, opens one for the restore, and restores the newest step a part per
 * task (`UndoGroups.restoreInSteps`).
 *
 * @param host - The history's parts.
 * @returns `undefined` when there is nothing to restore; otherwise the report.
 * @throws {StoreBusyError} When a run holds the store.
 */
export function startSteppedRestore(host: SteppedRestoreHost): Promise<RestoreReport> | undefined {
  host.internals.runs.check();
  const isUndo = host.direction === 'undo';
  if (!(isUndo ? host.manager.canUndo() : host.manager.canRedo())) return undefined;
  const run = host.internals.beginRun();
  host.clearLast();
  // Whether any part changed the document, as `undo()` says for a step of one part.
  let isChanged = false;
  const restoreOne = (): boolean => {
    const isPartChanged = host.restoreOne();
    isChanged ||= isPartChanged;
    return isPartChanged;
  };
  return host.groups
    .restoreInSteps(host.manager, host.direction, restoreOne, host.notify, run, host.yieldToBrowser)
    .then(({ parts, committedParts }) => ({
      parts,
      committedParts,
      isChanged,
      omission: host.history.lastOmission(),
      protection: host.history.lastProtection(),
      omittedObjects: host.history.lastOmittedObjects(),
    }));
}
