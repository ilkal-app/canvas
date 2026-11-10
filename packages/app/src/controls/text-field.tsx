import { useId, type ReactElement, type Ref } from 'react';

import styles from './text-field.module.css';

/** Props of {@link TextField}. */
export interface TextFieldProps {
  /** Its visible label ("Description"). */
  readonly label: string;
  /** Its value. */
  readonly value: string;
  /** Receives each edit. */
  readonly onChange: (value: string) => void;
  /** What it shows while empty ("Add a description"), in faint ink. */
  readonly placeholder?: string | undefined;
  /**
   * What is wrong with the value and how to fix it ("Enter a full email address"): the field is
   * then invalid, edged in red pencil, and described by the message. Valid when absent.
   */
  readonly error?: string | undefined;
  /** Whether it is disabled: 38% opacity, no hover, announced as disabled. */
  readonly isDisabled?: boolean | undefined;
  /** Its input type; `text` when absent. */
  readonly type?: 'text' | 'email' | 'search' | 'url' | undefined;
  /** The input element, to move focus to it. */
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
}

/**
 * The shared text field of the control states sheet (35:1786; UI-18): a label over a 36 px field
 * on the raised surface, its states empty (the placeholder in faint ink), hover (a stronger
 * edge), focus with the caret in hand/you and the shared ring outside, filled, error (the red
 * pencil's edge and, under it, a message that says how to fix it, which describes the field and
 * is announced politely) and disabled (38% opacity, no hover).
 *
 * @param props - Its label, value, placeholder, error and state.
 * @returns The field.
 */
export function TextField(props: TextFieldProps): ReactElement {
  const inputId = useId();
  const errorId = useId();
  const isInvalid = props.error !== undefined && props.error !== '';
  return (
    <span className={styles.textField}>
      <label htmlFor={inputId} className={styles.label}>
        {props.label}
      </label>
      <input
        ref={props.inputRef}
        id={inputId}
        type={props.type ?? 'text'}
        className={styles.input}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.isDisabled === true}
        aria-invalid={isInvalid ? true : undefined}
        aria-describedby={isInvalid ? errorId : undefined}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
      <span id={errorId} className={styles.error} aria-live="polite">
        {isInvalid ? props.error : null}
      </span>
    </span>
  );
}
