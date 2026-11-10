import type { ReactElement } from 'react';

import styles from './busy-indicator.module.css';
import { Spinner } from './spinner.js';
import type { StoreBusy } from './use-store-busy.js';

/** Props of {@link BusyIndicator}. */
export interface BusyIndicatorProps {
  /** Whether it shows and the progress (`useStoreBusy`). */
  readonly busy: StoreBusy;
}

/**
 * Says a large change is being applied while a stepped run holds the board:
 * "Applying changes…" with the shared spinner over the canvas, and a bar once the run reports
 * its progress. Nothing while hidden.
 *
 * @param props - Whether it shows and the progress.
 * @returns The indicator, or nothing.
 */
export function BusyIndicator(props: BusyIndicatorProps): ReactElement | null {
  const { isShown, progress } = props.busy;
  if (!isShown) return null;
  const percent = progress === undefined ? undefined : Math.round(progress * 100);
  return (
    <div className={styles.busy} role="status" aria-label="Applying changes">
      <Spinner size={14} />
      <span className={styles.label}>Applying changes…</span>
      {percent !== undefined && (
        <span
          className={styles.bar}
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className={styles.fill} style={{ width: `${String(percent)}%` }} />
        </span>
      )}
    </div>
  );
}
