import type { ReactElement, ReactNode } from 'react';

import styles from './control-states-sheet.module.css';

/** Props of {@link StatesRow}. */
export interface StatesRowProps {
  /** The row's name ("Primary button"), its heading and its region's name. */
  readonly name: string;
  /** Its controls. */
  readonly children: ReactNode;
}

/**
 * One labelled row of the control states sheet: a region named for the controls it shows.
 *
 * @param props - Its name and its controls.
 * @returns The row.
 */
export function StatesRow(props: StatesRowProps): ReactElement {
  return (
    <section className={styles.row} aria-label={props.name} data-states-row={props.name}>
      <h3 className={styles.rowName}>{props.name}</h3>
      <div className={styles.states}>{props.children}</div>
    </section>
  );
}
