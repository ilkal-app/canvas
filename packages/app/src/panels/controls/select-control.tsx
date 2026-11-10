import { useId, useRef, type ReactElement } from 'react';

import styles from './controls.module.css';
import { MIXED, type Mixable } from './mixed-value.js';

/** One choice of a {@link SelectControl}. */
export interface SelectOption {
  /** The value it sets. */
  readonly value: string;
  /** What the list shows. */
  readonly label: string;
}

/** Props of {@link SelectControl}. */
export interface SelectControlProps {
  /** The field's name. */
  readonly label: string;
  /** The chosen value, or {@link MIXED} when the selection disagrees. */
  readonly value: Mixable<string>;
  /** The choices, in order. */
  readonly options: readonly SelectOption[];
  /** Receives each choice, and the current value again when Enter/Escape releases focus. */
  readonly onChange: (value: string) => void;
  /**
   * Whether a pointer choice or Enter/Escape lets go of the keyboard, returning it to the text
   * editor. Arrow-key choices retain focus so the list can be explored; false by default.
   */
  readonly shouldReleaseFocus?: boolean;
  /** Whether the label is for assistive technology only, the field standing beside another's. */
  readonly isLabelHidden?: boolean;
}

/** The value of the disabled option that stands for a mixed selection. */
const MIXED_OPTION_VALUE = '';

/**
 * A choice among values: a native select, showing a disabled "Mixed"
 * option when the selection's values differ (the prototype's font family list did the same).
 * Choosing applies at once, one undo step per choice. With `shouldReleaseFocus`, a pointer choice
 * or Enter/Escape releases focus; keyboard navigation keeps it until committed or blurred.
 *
 * @param props - The label, value, options and handler.
 * @returns The control.
 */
export function SelectControl(props: SelectControlProps): ReactElement {
  const { label, value, options, onChange, shouldReleaseFocus = false } = props;
  const id = useId();
  const isPointerChoice = useRef(false);
  return (
    <div className={styles.control}>
      <label htmlFor={id} className={props.isLabelHidden === true ? styles.hidden : styles.label}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value === MIXED ? MIXED_OPTION_VALUE : value}
        onPointerDown={() => {
          isPointerChoice.current = true;
        }}
        onPointerCancel={() => {
          isPointerChoice.current = false;
        }}
        onBlur={() => {
          isPointerChoice.current = false;
        }}
        onKeyDown={(event) => {
          isPointerChoice.current = false;
          if (!shouldReleaseFocus || (event.key !== 'Enter' && event.key !== 'Escape')) return;
          // Match NumberControl: committing the field must not insert a newline or cancel
          // the editor after it regains focus.
          event.preventDefault();
          const chosen = event.currentTarget.value;
          event.currentTarget.blur();
          // Reapply after blur so the text bridge can reclaim focus, including a no-op
          // choice. Mixed is a disabled placeholder, never a font family to apply.
          if (chosen !== MIXED_OPTION_VALUE) onChange(chosen);
        }}
        onChange={(event) => {
          const chosen = event.currentTarget.value;
          const shouldBlur = shouldReleaseFocus && isPointerChoice.current;
          isPointerChoice.current = false;
          if (shouldBlur) event.currentTarget.blur();
          onChange(chosen);
        }}
      >
        {value === MIXED && (
          <option value={MIXED_OPTION_VALUE} disabled>
            Mixed
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
