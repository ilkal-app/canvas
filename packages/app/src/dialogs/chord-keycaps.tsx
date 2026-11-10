import type { ReactElement } from 'react';

import { formatChordParts } from '../shortcuts/chord-format.js';
import type { ParsedChord } from '../shortcuts/chord.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';

import styles from './chord-keycaps.module.css';

/** Props of {@link ChordKeycaps}. */
export interface ChordKeycapsProps {
  /** The chord to show. */
  readonly chord: ParsedChord;
  /** The platform whose symbols and order to use. */
  readonly platform: KeyboardPlatform;
}

/**
 * Shows a chord as one keycap per key (`⇧` `⌘` `Z`): nested `kbd` elements, the HTML markup for
 * a key combination.
 *
 * @param props - The chord and platform.
 * @returns The keycaps.
 */
export function ChordKeycaps(props: ChordKeycapsProps): ReactElement {
  const { chord, platform } = props;
  return (
    <kbd className={styles.keycaps}>
      {formatChordParts(chord, platform).map((part, index) => (
        // Parts are positional (modifiers in a fixed order, then the key), so the index is stable.
        <kbd key={index} className={styles.keycap}>
          {part}
        </kbd>
      ))}
    </kbd>
  );
}
