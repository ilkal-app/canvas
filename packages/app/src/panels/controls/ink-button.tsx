import type { ReactElement } from 'react';

import styles from './controls.module.css';
import { inkSwatchBackground } from './ink-swatch.js';

/** Props of {@link InkButton}. */
export interface InkButtonProps {
  /** Whether the field's value is `ink`. */
  readonly isPressed: boolean;
  /** Sets the field to `ink`. */
  readonly onInk: () => void;
}

/**
 * The Ink swatch of a stroke or text colour field: drawn half the light
 * theme's ink and half the dark theme's, named "Ink", pressed while the value is `ink`. A press
 * keeps the focus where it was (the text editor's, the canvas's).
 *
 * @param props - Whether it is pressed, and what a press does.
 * @returns The button.
 */
export function InkButton(props: InkButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={styles.ink}
      style={{ background: inkSwatchBackground() }}
      aria-pressed={props.isPressed}
      aria-label="Ink"
      title="Ink: dark on a light canvas, light on a dark one"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={props.onInk}
    />
  );
}
