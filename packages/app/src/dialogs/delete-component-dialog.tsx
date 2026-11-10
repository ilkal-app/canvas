import { useCallback, useId, useSyncExternalStore, type ReactElement } from 'react';

import { Button } from '../controls/button.js';
import { deletionQuestion } from '../engine/component-deletion.js';
import type { DeletionConfirmationSource } from '../engine/deletion-confirmations.js';

import styles from './delete-component-dialog.module.css';
import { Dialog } from './dialog.js';

/** Props of {@link DeleteComponentDialog}. */
export interface DeleteComponentDialogProps {
  /** Where the person's deletions wait (the engine's board view); nothing shows without. */
  readonly confirmations: DeletionConfirmationSource | undefined;
}

/**
 * Asks the person before a deletion detaches instances (ruling 6): while one waits, a
 * dialog says "Delete component “Card”? Its 3 instances become plain objects." with Cancel
 * (also Escape, Close and the backdrop), which keeps everything, and "Delete component", which
 * deletes as one undo step. Mounted, it is what makes such a deletion wait.
 *
 * @param props - The confirmations.
 * @returns The dialog, or nothing while no deletion waits.
 */
export function DeleteComponentDialog(props: DeleteComponentDialogProps): ReactElement | null {
  const { confirmations } = props;
  const questionId = useId();
  const subscribe = useCallback(
    (onChange: () => void) => confirmations?.subscribe(onChange) ?? (() => undefined),
    [confirmations],
  );
  const pending = useSyncExternalStore(subscribe, () => confirmations?.current());
  if (pending === undefined) return null;
  return (
    <div className={styles.overlay}>
      <Dialog
        title="Delete component"
        width="narrow"
        describedById={questionId}
        onClose={pending.cancel}
      >
        <div className={styles.body}>
          <p id={questionId} className={styles.question}>
            {deletionQuestion(pending.deletion)}
          </p>
          <div className={styles.actions}>
            <Button onClick={pending.cancel}>Cancel</Button>
            <Button kind="danger" onClick={pending.confirm}>
              Delete component
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
