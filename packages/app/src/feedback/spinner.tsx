import type { ReactElement } from 'react';

import styles from './spinner.module.css';

/** A spinner's size in CSS px (Figma 35:1765: 12, 16 and 24; 14 inside a busy button). */
export type SpinnerSize = 12 | 14 | 16 | 24;

/** Props of {@link Spinner}. */
export interface SpinnerProps {
  /** Its size; 16, the component's own, when absent. */
  readonly size?: SpinnerSize;
}

/**
 * The shared Spinner (Figma 35:1765; UI-18): a ring on the hairline with an arc in the text
 * colour, its stroke an eighth of its size, turning; still under the system's reduced-motion
 * setting. Decorative (`aria-hidden`): the words beside it say what is happening ("Saving…").
 *
 * @param props - Its size.
 * @returns The spinner.
 */
export function Spinner(props: SpinnerProps): ReactElement {
  return (
    <span
      className={styles.spinner}
      data-size={props.size ?? 16}
      aria-hidden="true"
      data-spinner=""
    />
  );
}
