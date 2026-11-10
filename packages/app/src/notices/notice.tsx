import type { ReactElement } from 'react';

import { useToast } from '../feedback/toast-region.js';
import { TOAST_DURATION_MS } from '../feedback/toast.js';
import type { ShellNotice } from '../hooks/use-notice.js';

/** How long a notice shows before it goes by itself, ms (D-TOAST's Info; a canvas action may clear it first). */
export const NOTICE_DURATION_MS = TOAST_DURATION_MS;

/** Props of {@link Notice}. */
export interface NoticeProps {
  /** The notice, or undefined while there is none. */
  readonly notice: ShellNotice | undefined;
  /** Hides it: its Dismiss button, Escape, and after {@link NOTICE_DURATION_MS}. */
  readonly onDismiss: () => void;
}

/**
 * The shell's one notice (why an action did nothing, a refused command, objects an order command
 * left out, what the clipboard could not do, an undo another person's change kept; `useNotice`),
 * posted to the toast region as an Info toast (item 4): a `role="status"` region
 * labelled "Notice", above the dock, with its button ("Go to <page>", which also hides
 * it) and Dismiss. It goes after {@link NOTICE_DURATION_MS} (D-TOAST), when dismissed or by
 * Escape; a new notice (a new `sequence`) restarts the time, even with the same words. Renders
 * nothing in place.
 *
 * @param props - The notice and the dismiss handler.
 * @returns Nothing inside the toast region; without one, the toast in place.
 */
export function Notice(props: NoticeProps): ReactElement | null {
  const { notice, onDismiss } = props;
  const action = notice?.action;
  const shown = useToast(
    notice === undefined
      ? undefined
      : {
          kind: 'info',
          message: notice.message,
          label: 'Notice',
          key: notice.sequence,
          onDismiss,
          action:
            action === undefined
              ? undefined
              : {
                  label: action.label,
                  onAction: () => {
                    action.run();
                    onDismiss();
                  },
                },
        },
  );
  return shown;
}
