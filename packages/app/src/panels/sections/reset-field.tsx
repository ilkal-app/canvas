import type { ReactElement, ReactNode } from 'react';

import controls from '../controls/controls.module.css';

import styles from './component-sections.module.css';

/** Props of {@link ResetField}. */
export interface ResetFieldProps {
  /** The property's name, lower case after "Reset" in the button's name. */
  readonly label: string;
  /** Whether the instance overrides it: the button shows only then. */
  readonly isOverridden: boolean;
  /** Whether a chosen variant's preset sets it: "From variant" shows unless overridden. */
  readonly isFromVariant?: boolean;
  /** Clears the override of it alone. */
  readonly onReset: () => void;
  /** The property's control. */
  readonly children?: ReactNode;
}

/**
 * A property's control with "Reset" beside it while the instance overrides that property
 * (rule 4: Reset clears one property), named "Reset <property>".
 *
 * @param props - The label, whether it is overridden, the reset and the control.
 * @returns The line.
 */
export function ResetField(props: ResetFieldProps): ReactElement {
  return (
    <div className={styles.field}>
      <div className={styles.fieldControl}>{props.children}</div>
      {!props.isOverridden && props.isFromVariant === true && (
        <span className={styles.fromVariant}>From variant</span>
      )}
      {props.isOverridden && (
        <button
          type="button"
          className={controls.button}
          aria-label={`Reset ${props.label}`}
          onClick={props.onReset}
        >
          Reset
        </button>
      )}
    </div>
  );
}
