import type { ReactElement } from 'react';

import { isTokenRef, type Color } from '@canvas/schema';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from '@canvas/tools';

import { rgbaToCss } from '../controls/colour-hex.js';
import { commonValue, isSameColour, MIXED, type Mixable } from '../controls/mixed-value.js';
import { TokenParts } from '../controls/token-parts.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './note-section.module.css';

/**
 * The colour the section shows as picked: the selected notes' colour (mixed when they differ),
 * or, with nothing selected, the sticky tool's; a board colour token as itself.
 *
 * @param props - The panel's props.
 * @returns The colour, or {@link MIXED}.
 */
function currentColourOf(props: StylePanelSectionProps): Mixable<Readonly<Color>> {
  const notes = props.selection.flatMap((object) => (object.type === 'sticky' ? [object] : []));
  const shared = commonValue(notes, (note): Readonly<Color> => note.color, isSameColour);
  return shared ?? props.defaults?.color ?? DEFAULT_NOTE_COLOR;
}

/**
 * The style panel's note section: the palette, a swatch per colour of `NOTE_COLORS`, each
 * a toggle named by its colour, the selected notes' colour pressed (none when they differ or name a
 * token), then the board's colour tokens (`TokenParts`). A pick recolours the selected
 * notes as one style change, so one `setStyle` and one undo step, and becomes the sticky tool's
 * colour, so the next note takes the colour last picked; with nothing selected it sets the tool's
 * colour alone. A press keeps the focus where it was, so a note being edited stays edited.
 *
 * @param props - The panel's props.
 * @returns The palette.
 */
function NoteSection(props: StylePanelSectionProps): ReactElement {
  const { selection, applyStyle, dispatch } = props;
  const current = currentColourOf(props);
  const pick = (color: Color) => {
    applyStyle({ color });
    if (selection.length > 0) dispatch({ type: 'setToolStyle', tool: 'sticky', style: { color } });
  };
  return (
    <>
      <div className={styles.palette} role="group" aria-label="Note colour">
        {NOTE_COLORS.map(({ name, color }) => (
          <button
            key={name}
            type="button"
            className={styles.swatch}
            aria-label={name}
            title={name}
            aria-pressed={current !== MIXED && !isTokenRef(current) && isSameColour(current, color)}
            style={{ backgroundColor: rgbaToCss(color) }}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              pick([...color]);
            }}
          />
        ))}
      </div>
      <div className={styles.tokens}>
        <TokenParts
          label="Note colour"
          token={current !== MIXED && isTokenRef(current) ? current : undefined}
          onToken={pick}
          onDetach={pick}
        />
      </div>
    </>
  );
}

/**
 * The style panel's note section: shown for sticky notes and while the sticky tool is
 * active (the `note` context), first among that context's sections.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'note',
  title: 'Note',
  context: 'note',
  order: 5,
  render: NoteSection,
};
