// The text section's direction toggles and the side a start or end alignment shows.
import type { ReactElement } from 'react';

import type { TextAlign, TextBaseDirection } from '@canvas/engine';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import type { IconName } from '../../icons/icon-paths.js';
import { MIXED, type Mixable } from '../controls/mixed-value.js';
import { ToggleControl } from '../controls/toggle-control.js';

import styles from './text-style-section.module.css';

/** The alignment toggles: each one's value, label and icon. */
export const ALIGNS: readonly (readonly [TextAlign, string, IconName])[] = [
  ['left', 'Left', 'text-left'],
  ['center', 'Centre', 'text-centre'],
  ['right', 'Right', 'text-right'],
];

/** Each direction: its value, its toggle's label, and the toggle's short text. */
const DIRECTIONS: readonly (readonly [TextBaseDirection, string, string])[] = [
  ['auto', 'Auto direction', 'Auto'],
  ['ltr', 'Left to right', 'LTR'],
  ['rtl', 'Right to left', 'RTL'],
];

/**
 * The physical alignment the targeted text shows, for the left, centre and right toggles: a
 * `start` or `end` alignment resolves by the direction (an auto one by the text's first strong
 * character), and is mixed when the direction, or for auto text that character's, is.
 *
 * @param context - The section's context.
 * @returns The alignment, or `undefined` when mixed.
 */
export function shownAlign(context: TextStyleContext): TextAlign | undefined {
  const { align, direction = 'auto', autoDirection = 'ltr' } = context;
  if (align !== 'start' && align !== 'end') return align;
  const resolved = direction === 'auto' ? autoDirection : direction;
  if (resolved === MIXED) return undefined;
  const isRightToLeft = resolved === 'rtl';
  return (align === 'start') === isRightToLeft ? 'right' : 'left';
}

/** Props of {@link DirectionRow}. */
export interface DirectionRowProps {
  /** What the section shows. */
  readonly context: TextStyleContext;
  /** Applies a change to the targeted text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * The base direction toggles of the targeted text objects and notes: auto (each
 * paragraph's first strong character's), left to right, or right to left; an absent direction
 * shows as auto, and a selection that differs as mixed.
 *
 * @param props - The context and the change callback.
 * @returns The row.
 */
export function DirectionRow(props: DirectionRowProps): ReactElement {
  const { context, onChange } = props;
  const direction: Mixable<TextBaseDirection> = context.direction ?? 'auto';
  return (
    <div className={styles.row} role="group" aria-label="Direction">
      {DIRECTIONS.map(([value, label, text]) => (
        <ToggleControl
          key={value}
          label={label}
          value={direction === MIXED ? MIXED : direction === value}
          onChange={() => {
            onChange({ kind: 'direction', direction: value });
          }}
        >
          {text}
        </ToggleControl>
      ))}
    </div>
  );
}
