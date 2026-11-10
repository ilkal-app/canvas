import { useId, type ReactElement } from 'react';

import styles from './toggle.module.css';

/** Props of {@link Toggle}. */
export interface ToggleProps {
  /**
   * Its label ("Agents can edit this board"), shown after it; absent when the screen labels it
   * itself, with a `<label htmlFor>` naming {@link ToggleProps.id}.
   */
  readonly label?: string | undefined;
  /** Its element's id, for a label of the screen's own; a generated one when absent. */
  readonly id?: string | undefined;
  /** Whether it is on. */
  readonly isOn: boolean;
  /** Receives the new state. */
  readonly onChange: (isOn: boolean) => void;
  /** Whether it is disabled: 38% opacity, no hover, announced as disabled. */
  readonly isDisabled?: boolean | undefined;
  /** The id of a hint that describes it, if any. */
  readonly describedBy?: string | undefined;
}

/**
 * The shared toggle of the control states sheet (35:1786; UI-18): a switch (`role="switch"` on a
 * checkbox, so Space toggles it and it is announced on or off), a 32 × 18 track with a 14 px
 * knob, off on the pressed surface with a faint knob, on in the action's fill with its knob to the
 * right; keyboard focus is the shared ring outside it; disabled is 38% opacity, announced.
 *
 * @param props - Its label, state and handler.
 * @returns The toggle.
 */
export function Toggle(props: ToggleProps): ReactElement {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <span className={styles.toggleField}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className={styles.toggle}
        checked={props.isOn}
        disabled={props.isDisabled === true}
        aria-describedby={props.describedBy}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
      />
      {props.label === undefined ? null : (
        <label htmlFor={id} className={styles.label}>
          {props.label}
        </label>
      )}
    </span>
  );
}
