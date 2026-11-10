import type { ReactElement } from 'react';

import styles from './chip.module.css';

/** Props of {@link Chip}. */
export interface ChipProps {
  /** Its words ("Square"), and its name. */
  readonly label: string;
  /** Whether it is on: the pressed surface and the primary ink. */
  readonly isActive: boolean;
  /** Receives the new state when it is pressed. */
  readonly onToggle: (isActive: boolean) => void;
  /** Whether it is disabled: 38%, announced. */
  readonly isDisabled?: boolean | undefined;
  /** More attributes: `data-dock-item` for a toolbar's roving focus, and the like. */
  readonly dataAttributes?: Readonly<Record<`data-${string}`, string>> | undefined;
}

/**
 * A chip (the Library page's Chip): a 24 px toggle button with round ends, default
 * (secondary ink, the control edge) and active (`aria-pressed`, the pressed surface and the
 * primary ink); the shared focus ring; disabled at 38%. On a touch screen it takes presses 12 px
 * above and below, so its target is 48 px tall while it still looks 24.
 *
 * @param props - Its words, state and handler.
 * @returns The chip.
 */
export function Chip(props: ChipProps): ReactElement {
  return (
    <button
      type="button"
      className={styles.chip}
      aria-pressed={props.isActive}
      disabled={props.isDisabled === true}
      {...props.dataAttributes}
      onClick={() => {
        props.onToggle(!props.isActive);
      }}
    >
      {props.label}
    </button>
  );
}
