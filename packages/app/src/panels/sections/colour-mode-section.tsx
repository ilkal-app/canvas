import type { ReactElement } from 'react';

import type { BoardObject, ColorMode } from '@canvas/schema';

import controls from '../controls/controls.module.css';
import { commonValue, MIXED } from '../controls/mixed-value.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './colour-mode-section.module.css';

/** A container's own colour mode: `auto` (inherited) or an explicit one. */
type ModeChoice = 'auto' | ColorMode;

/** The choices, in order, and their names. */
const CHOICES: readonly (readonly [ModeChoice, string])[] = [
  ['auto', 'Auto'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/**
 * A frame's, main's or instance's own colour mode: `auto` when it sets none.
 *
 * @param object - The object.
 * @returns Its choice.
 */
function choiceOf(object: BoardObject): ModeChoice {
  if (object.type !== 'frame' && object.type !== 'component' && object.type !== 'instance') {
    return 'auto';
  }
  return object.colorMode ?? 'auto';
}

/**
 * The inspector's Colours section: whether the selected frames, mains or instances draw
 * their content's colour tokens in the light or the dark value, or inherit (Auto: the enclosing
 * frame, main or instance, else the viewer's theme). A segmented control, none pressed when the
 * selection differs; a press sets `colorMode` (`null` for Auto) as one `setStyle`, one undo step.
 *
 * @param props - The panel's props.
 * @returns The control.
 */
function ColourModeSection(props: StylePanelSectionProps): ReactElement {
  const { selection, applyStyle } = props;
  const current = commonValue(selection, choiceOf) ?? MIXED;
  return (
    <div className={styles.modes} role="group" aria-label="Colour mode">
      {CHOICES.map(([choice, label]) => (
        <button
          key={choice}
          type="button"
          className={controls.toggle}
          aria-pressed={current === choice}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            applyStyle({ colorMode: choice === 'auto' ? null : choice });
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The inspector's Colours section: for frames, mains and instances, after their own
 * section; selection only (no creation tool keeps a mode).
 */
export const stylePanelSection: StylePanelSection = {
  id: 'colour-mode',
  title: 'Colours',
  context: ['frame', 'component', 'instance'],
  order: 6,
  isSelectionOnly: true,
  render: ColourModeSection,
};
