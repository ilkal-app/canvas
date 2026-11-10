import { useRef, type ReactElement } from 'react';

import { useTheme } from '../../hooks/use-theme.js';
import type { ChromeFontSet } from '../../theme/chrome-fonts.js';
import type { ThemePreference } from '../../theme/theme-preference.js';

import styles from './field-states-sheet.module.css';
import { MIXED } from './mixed-value.js';
import { NumberControl } from './number-control.js';

/** What {@link FieldStatesSheet} takes. */
export interface FieldStatesSheetProps {
  /** The theme preference to start with; the stored one if absent. */
  readonly initialThemePreference?: ThemePreference;
  /** The fonts the chrome is set in; the shell's own if absent. */
  readonly chromeFonts?: ChromeFontSet;
}

/**
 * Takes a value and does nothing with it: the sheet's fields edit no board.
 *
 * @returns Nothing.
 */
const IGNORE = (): void => undefined;

/**
 * The field states sheet: the inspector's number field, on a drawer's sheet, enabled
 * (to focus, scrub or give an invalid value), mixed and disabled, as the control states sheet
 * draws them, for the shell's screenshot baselines and axe. No field in the inspector is
 * disabled today, so this is where the disabled state is seen. The harness page shows it for
 * `?view=fields`.
 *
 * @param props - The starting theme preference.
 * @returns The sheet.
 */
export function FieldStatesSheet(props: FieldStatesSheetProps): ReactElement {
  const rootRef = useRef<HTMLElement>(null);
  const { themeName } = useTheme(rootRef, props.initialThemePreference, props.chromeFonts);
  return (
    <main ref={rootRef} className={styles.page} data-field-states={themeName}>
      <section className={styles.sheet} aria-labelledby="field-states-title" data-sheet="">
        <h1 id="field-states-title" className={styles.title}>
          Field states
        </h1>
        <NumberControl label="Width" value={576} min={1} max={4096} onChange={IGNORE} />
        <NumberControl label="Height" value={MIXED} min={1} max={4096} onChange={IGNORE} />
        <NumberControl label="Radius" value={3} min={0} max={64} isDisabled onChange={IGNORE} />
      </section>
    </main>
  );
}
