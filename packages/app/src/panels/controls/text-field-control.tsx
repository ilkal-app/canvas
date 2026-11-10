import { useEffect, useId, useState, type ReactElement } from 'react';

import { isImeKey } from '../../shortcuts/ime-key.js';

import styles from './controls.module.css';

/** Props of {@link TextFieldControl}. */
export interface TextFieldControlProps {
  /** The field's name. */
  readonly label: string;
  /** The value the document holds. */
  readonly value: string;
  /** The most characters it takes; no limit if absent. */
  readonly maxLength?: number;
  /** Receives the value typed, once committed and only when it differs from `value`. */
  readonly onCommit: (value: string) => void;
  /**
   * Whether a typed value may be committed; one it refuses is not, and the field shows `value`
   * again. Every value when absent.
   */
  readonly accepts?: (value: string) => boolean;
}

/**
 * A one-line text field: a draft while the person types, committed on
 * Enter or when the field loses focus, so one change is one command and one undo step;
 * Escape puts the document's value back. A new value from the document replaces the draft.
 *
 * @param props - The label, value, limit and handler.
 * @returns The control.
 */
export function TextFieldControl(props: TextFieldControlProps): ReactElement {
  const { label, value, onCommit } = props;
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = (): void => {
    if (draft === value) return;
    if (props.accepts?.(draft) === false) setDraft(value);
    else onCommit(draft);
  };
  return (
    <div className={styles.control}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className={styles.input}
        value={draft}
        maxLength={props.maxLength}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (isImeKey(event.nativeEvent)) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            setDraft(value);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
