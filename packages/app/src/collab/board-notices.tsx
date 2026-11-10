import type { ReactElement, ReactNode } from 'react';

import { MissingFontsNotice } from '../text-input/missing-fonts-notice.js';

import type { BoardConnection } from './board-connection.js';
import { CacheRecoveryNotice } from './cache-recovery-notice.js';
import { StrandedEditsNotice } from './stranded-edits-notice.js';
import { ViewOnlyNotice } from './view-only-notice.js';

/** Props of {@link BoardNotices}. */
export interface BoardNoticesProps {
  /** The board's connection. */
  readonly connection: BoardConnection;
  /** The board's name as the page shows it (the site's title); the board id when absent. */
  readonly boardName?: string | undefined;
  /** Whether the person may edit the board (the shell's `canEdit`). */
  readonly canEdit: boolean;
  /** The host's own notice, first in the stack (the site's session-ended notice); none if absent. */
  readonly hostNotice?: ReactNode;
  /**
   * Opens the board-wide replacement of a missing font (the missing-fonts notice's
   * Replace…); the notice offers none if absent.
   */
  readonly onReplaceMissingFont?: ((family: string) => void) | undefined;
}

/**
 * Persistent notices about the board, posted to the toast region over the dock (item 4,
 * our decision of 2026-10-07): the host's own (the site's session-ended notice,
 *), that they can only view it (`ViewOnlyNotice`), retained device content with
 * a recovery download (`CacheRecoveryNotice`), edits a stored-layout bump stranded (
 * `StrandedEditsNotice`), then fonts the board names that the page cannot show (
 * `MissingFontsNotice`). Unlike the shell's passing notice they never go by themselves: each
 * stays while its condition holds. Main thread.
 *
 * @param props - The connection, the board's name and whether the person may edit.
 * @returns Their posters; nothing shows in place.
 */
export function BoardNotices(props: BoardNoticesProps): ReactElement {
  const { connection, boardName, canEdit } = props;
  return (
    <>
      {props.hostNotice}
      <ViewOnlyNotice
        canEdit={canEdit}
        boardId={connection.status().boardId}
        lock={connection.status().planLock}
      />
      <CacheRecoveryNotice recovery={connection.recovery} boardId={connection.status().boardId} />
      <StrandedEditsNotice connection={connection} boardName={boardName} />
      <MissingFontsNotice
        store={connection.store}
        boardId={connection.status().boardId}
        canEdit={canEdit && props.onReplaceMissingFont !== undefined}
        onReplace={(family) => {
          props.onReplaceMissingFont?.(family);
        }}
      />
    </>
  );
}
