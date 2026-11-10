import { useState, type KeyboardEvent, type ReactElement } from 'react';

import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';

import styles from './custom-number-footer.module.css';

/** Props of {@link CustomNumberFooter}. */
export interface CustomNumberFooterProps {
  /** The value the selection shares, or mixed: the field starts with it. */
  readonly value: Mixable<number>;
  /** The smallest whole number the field takes. */
  readonly min: number;
  /** The largest whole number the field takes. */
  readonly max: number;
  /** The field's accessible name ("Custom font size"). */
  readonly fieldLabel: string;
  /** The row's accessible name ("Custom size"). */
  readonly groupLabel: string;
  /** Receives a valid number that differs from the value. */
  readonly onCommit: (value: number) => void;
  /** Closes the menu. */
  readonly close: () => void;
}

/**
 * A dropdown menu's Custom row, after a rule ('s font size;'s stroke width): a whole
 * number from `min` to `max`, set by Enter, which closes the menu; anything else is marked invalid
 * and changes nothing. CompactDropdown's `footer`.
 *
 * @param props - The value, the bounds, the names, the handler and how to close the menu.
 * @returns The rule and the row.
 */
export function CustomNumberFooter(props: CustomNumberFooterProps): ReactElement {
  const [text, setText] = useState(props.value === MIXED ? '' : String(props.value));
  const [isInvalid, setInvalid] = useState(false);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = Number(text.trim());
    const isValid =
      text.trim() !== '' && Number.isInteger(value) && value >= props.min && value <= props.max;
    setInvalid(!isValid);
    if (!isValid) return;
    if (value !== props.value) props.onCommit(value);
    props.close();
  };
  return (
    <>
      <div role="separator" className={styles.rule} />
      <div role="group" aria-label={props.groupLabel} className={styles.custom}>
        <span className={styles.label} aria-hidden="true">
          Custom
        </span>
        <input
          type="number"
          className={styles.field}
          aria-label={props.fieldLabel}
          aria-invalid={isInvalid}
          min={props.min}
          max={props.max}
          step={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
    </>
  );
}
