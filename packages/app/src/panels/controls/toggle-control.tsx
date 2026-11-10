import type { ReactElement, ReactNode } from 'react';

import styles from './controls.module.css';
import { MIXED, type Mixable } from './mixed-value.js';

/** Props of {@link ToggleControl}. */
export interface ToggleControlProps {
  /** The accessible name (`Bold`). */
  readonly label: string;
  /** What the button shows (`B`); the label if absent. */
  readonly children?: ReactNode;
  /** Whether the field is on, or {@link MIXED} when the selection disagrees. */
  readonly value: Mixable<boolean>;
  /**
   * Whether it is an item of a row with roving focus (`useRovingFocus`: the route's icons), which
   * then keeps its tab stop; false if absent.
   */
  readonly isRovingItem?: boolean;
  /** Receives the new value: on from off or mixed, off from on. */
  readonly onChange: (value: boolean) => void;
}

/**
 * An on/off field: a toggle button whose `aria-pressed` is `true`,
 * `false`, or `mixed` when the selection disagrees (the prototype's bold and italic buttons).
 * Pressing it in a mixed state turns the field on for all. A mouse press keeps focus where it
 * was, so the text editor's selection survives.
 *
 * @param props - The label, value and handler.
 * @returns The control.
 */
export function ToggleControl(props: ToggleControlProps): ReactElement {
  const { label, children, value, onChange } = props;
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={label}
      title={label}
      aria-pressed={value === MIXED ? 'mixed' : value}
      data-dock-item={props.isRovingItem === true ? '' : undefined}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        onChange(value !== true);
      }}
    >
      {children ?? label}
    </button>
  );
}
