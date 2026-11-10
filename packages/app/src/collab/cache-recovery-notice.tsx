import { useRef, useState, useSyncExternalStore, type ReactElement } from 'react';

import { useToast } from '../feedback/toast-region.js';

import type { BoardRecoverySource } from './board-connection.js';
import { downloadRecoverySources } from './download-recovery-sources.js';

/** Props of the persistent retained-content notice. */
export interface CacheRecoveryNoticeProps {
  /** Current recovery, if this open found retained local content. */
  readonly recovery: BoardRecoverySource | undefined;
  /** Board identity included in the export. */
  readonly boardId: string;
}

/**
 * Describes the current recovery state without claiming every saved record is restored.
 *
 * @param state - Observable recovery status.
 * @returns The persistent notice message.
 */
function recoveryMessage(state: BoardRecoverySource['state']): string {
  if (state.phase === 'waiting')
    return 'Saved content is waiting for a connection. Your original copy is still on this device.';
  if (state.phase === 'recovering')
    return 'Checking saved content. Your original copy is still on this device.';
  if (state.phase === 'failed')
    return 'Recovery could not finish. Your original copy is still on this device.';
  const count = state.unresolvedRecordCount;
  return `${String(count)} saved ${count === 1 ? 'record' : 'records'} could not be restored. Your original copy is still on this device.`;
}

/**
 * Keeps unresolved device content visible until it can be integrated safely: an Info toast in the
 * toast region (item 4), a `role="status"` region labelled "Saved recovery copy", with
 * Download recovery copy and no Dismiss, for as long as there is something to recover. A second
 * press while a download runs does nothing.
 *
 * @param props - Recovery status and board identity.
 * @param props.recovery - Current retained recovery source.
 * @param props.boardId - Board identity for export.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
export function CacheRecoveryNotice({
  recovery,
  boardId,
}: CacheRecoveryNoticeProps): ReactElement | null {
  const state = useSyncExternalStore(
    (listener) => recovery?.subscribe(listener) ?? (() => undefined),
    () => recovery?.state,
  );
  const isDownloadingRef = useRef(false);
  const [hasFailed, setFailed] = useState(false);
  const isVisible =
    state !== undefined && (state.phase !== 'retained' || state.unresolvedRecordCount > 0);
  const download = async (): Promise<void> => {
    if (recovery === undefined || isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setFailed(false);
    try {
      await downloadRecoverySources(recovery, boardId);
    } catch {
      setFailed(true);
    } finally {
      isDownloadingRef.current = false;
    }
  };
  const shown = useToast(
    isVisible
      ? {
          kind: 'info',
          message: `${recoveryMessage(state)}${hasFailed ? ' Download failed. Try again.' : ''}`,
          label: 'Saved recovery copy',
          isPersistent: true,
          action: {
            label: 'Download recovery copy',
            onAction: () => {
              void download();
            },
          },
        }
      : undefined,
  );
  return shown;
}
