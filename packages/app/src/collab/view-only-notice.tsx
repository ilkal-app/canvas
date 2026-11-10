import { useEffect, useState, type ReactElement } from 'react';

import { useToast } from '../feedback/toast-region.js';

import { PAGE_VIEW_ONLY_NOTICES, type ViewOnlyNoticeMemory } from './view-only-notice-memory.js';

/** What the notice says. */
export const VIEW_ONLY_MESSAGE = 'You can view this board';

/** Props of {@link ViewOnlyNotice}. */
export interface ViewOnlyNoticeProps {
  /** Whether the person may edit the board (the shell's `canEdit`). */
  readonly canEdit: boolean;
  /** The board, which the notice is remembered for. */
  readonly boardId: string;
  /** Which boards' notice showed this session; the page's (`PAGE_VIEW_ONLY_NOTICES`) if absent. */
  readonly memory?: ViewOnlyNoticeMemory;
  /** The board's lock past its owner's plan: the notice names the owner's limit. */
  readonly lock?: { readonly boards: number } | null | undefined;
}

/**
 * The view-only notice of a board past its owner's plan (R4).
 *
 * @param boards - The owner's board limit.
 * @returns The sentence.
 */
export function planLockMessage(boards: number): string {
  return `This board is read-only because its owner's plan includes ${String(boards)} boards.`;
}

/** What the notice holds between renders: the `canEdit` it last saw and whether it shows. */
interface NoticeState {
  readonly canEdit: boolean;
  readonly isShown: boolean;
}

/**
 * Tells a person who cannot edit the board that they can view it, in the board's
 * notices beside the stranded-edits notice: once per board per session when the board opens
 * read-only (`ViewOnlyNoticeMemory`), and again whenever an editor is made a viewer while the
 * board is open; never to someone who can edit, and gone as soon as they can. It stays until
 * the person dismisses it (its Dismiss, or Escape): a board-level state, it never goes by
 * itself. An Info toast in the toast region (item 4), a `role="status"` region labelled
 * "Board access". Main thread.
 *
 * @param props - Whether the person may edit, the board and the memory.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
export function ViewOnlyNotice(props: ViewOnlyNoticeProps): ReactElement | null {
  const { canEdit, boardId, memory = PAGE_VIEW_ONLY_NOTICES, lock } = props;
  const [state, setState] = useState<NoticeState>(() => ({
    canEdit,
    isShown: !canEdit && !memory.hasShown(boardId),
  }));
  // A change of role while the board is open: made a viewer shows it again, an editor hides it.
  if (state.canEdit !== canEdit) setState({ canEdit, isShown: !canEdit });
  const isShown = state.isShown && !canEdit;
  useEffect(() => {
    if (isShown) memory.remember(boardId);
  }, [isShown, memory, boardId]);
  const shown = useToast(
    isShown
      ? {
          kind: 'info',
          message:
            lock === null || lock === undefined ? VIEW_ONLY_MESSAGE : planLockMessage(lock.boards),
          label: 'Board access',
          isPersistent: true,
          onDismiss: () => {
            setState({ canEdit, isShown: false });
          },
        }
      : undefined,
  );
  return shown;
}
