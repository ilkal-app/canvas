import { useRef, useState, useSyncExternalStore, type ReactElement } from 'react';

import type { StrandedEdits } from '@canvas/collab';

import { useToast } from '../feedback/toast-region.js';

import type { BoardConnection } from './board-connection.js';
import { downloadRecoverySources } from './download-recovery-sources.js';
import { strandedEditsMessage } from './stranded-edits-message.js';

/** What the notice reads: a board connection's status and its changes, and how to dismiss. */
export type StrandedEditsSourceConnection = Pick<
  BoardConnection,
  'status' | 'subscribe' | 'dismissStrandedEdits'
>;

/** Props of {@link StrandedEditsNotice}. */
export interface StrandedEditsNoticeProps {
  /** The board's connection. */
  readonly connection: StrandedEditsSourceConnection;
  /** The board's name as the page shows it (the site's title); the board id when absent. */
  readonly boardName?: string | undefined;
}

/** What the failure of a manual source's download says (an Error toast). */
export const SAVED_COPY_DOWNLOAD_FAILED_MESSAGE =
  'Could not download the saved copy. It is still on this device. Try again.';

/** The live region's name of each stranded-edits toast. */
const LABEL = 'Changes not carried over';

/**
 * Tells the person about edits a stored-layout bump stranded: for each earlier copy,
 * an Info toast in the toast region (item 4), a `role="status"` region labelled "Changes
 * not carried over", saying the board, how many unsent changes and the two layouts, with
 * Dismiss, which deletes that layout's copy of the board (an action, so neither Escape nor time
 * takes it), or, for a manual source, Download saved copy. Unlike the shell's passing notice it
 * never goes by itself: the copy is kept until the person says so. Main thread.
 *
 * @param props - The connection and the board's name.
 * @returns The toasts' posters; nothing shows in place inside the toast region.
 */
export function StrandedEditsNotice(props: StrandedEditsNoticeProps): ReactElement {
  const { connection } = props;
  const status = useSyncExternalStore(
    (listener) => connection.subscribe(listener),
    () => connection.status(),
  );
  const boardName = props.boardName ?? status.boardId;
  return (
    <>
      {status.strandedEdits.map((edits) =>
        edits.exportSource === undefined ? (
          <DismissibleCopy
            key={edits.source}
            message={strandedEditsMessage(edits, boardName)}
            onDismiss={() => {
              connection.dismissStrandedEdits(edits.source);
            }}
          />
        ) : (
          <ManualSourceDownload
            key={edits.source}
            edits={edits}
            message={strandedEditsMessage(edits, boardName)}
          />
        ),
      )}
    </>
  );
}

/**
 * A copy the person may delete: its toast, Dismiss its action.
 *
 * @param props - The message and what Dismiss does.
 * @param props.message - What the toast says.
 * @param props.onDismiss - Deletes the copy.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
function DismissibleCopy(props: {
  readonly message: string;
  readonly onDismiss: () => void;
}): ReactElement | null {
  return useToast({
    kind: 'info',
    message: props.message,
    label: LABEL,
    isPersistent: true,
    action: { label: 'Dismiss', onAction: props.onDismiss },
  });
}

/**
 * Downloads a manual source without deleting or replaying it; a failure says so in an Error
 * toast that stays until dismissed or the next try.
 *
 * @param props - The retained source and latest-byte reader, and the message.
 * @param props.edits - The retained source and latest-byte reader.
 * @param props.message - What the toast says.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
function ManualSourceDownload(props: {
  readonly edits: StrandedEdits;
  readonly message: string;
}): ReactElement | null {
  const { edits } = props;
  const isDownloadingRef = useRef(false);
  const [hasFailed, setFailed] = useState(false);
  const download = async (): Promise<void> => {
    if (edits.exportSource === undefined || isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setFailed(false);
    try {
      const source = await edits.exportSource();
      await downloadRecoverySources(
        {
          exportSources: () =>
            Promise.resolve([
              {
                generation: 0,
                replayPolicy: 'manual',
                board: source.board,
                snapshotVersion: source.snapshotVersion,
                updateKeys: source.updateKeys,
              },
            ]),
        },
        edits.boardId,
      );
    } catch {
      setFailed(true);
    } finally {
      isDownloadingRef.current = false;
    }
  };
  const copy = useToast({
    kind: 'info',
    message: props.message,
    label: LABEL,
    isPersistent: true,
    action: {
      label: 'Download saved copy',
      onAction: () => {
        void download();
      },
    },
  });
  const failure = useToast(
    hasFailed
      ? {
          kind: 'error',
          message: SAVED_COPY_DOWNLOAD_FAILED_MESSAGE,
          onDismiss: () => {
            setFailed(false);
          },
        }
      : undefined,
  );
  return copy === null && failure === null ? null : (
    <>
      {copy}
      {failure}
    </>
  );
}
