import type { ReactElement } from 'react';

import controls from '../controls/controls.module.css';
import type { StylePanelSection } from '../panel-sections.js';

/** What the inspector says for objects of several kinds (Figma "Mixed kinds"). */
export const MIXED_KINDS_MESSAGE = 'Select one kind of object to change its style.';

/**
 * The note for a selection of several kinds.
 *
 * @returns The note.
 */
function MixedKinds(): ReactElement {
  return <p className={controls.hint}>{MIXED_KINDS_MESSAGE}</p>;
}

/**
 * The inspector's style note for objects of several kinds: their styles cannot be
 * edited together, so the section says to select one kind; the arrange section follows it.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'mixed-kinds',
  title: 'Style',
  context: 'mixed',
  order: 1,
  isSelectionOnly: true,
  render: MixedKinds,
};
