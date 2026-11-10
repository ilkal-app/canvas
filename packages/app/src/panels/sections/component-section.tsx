import type { ReactElement } from 'react';

import controls from '../controls/controls.module.css';
import { TextFieldControl } from '../controls/text-field-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './component-sections.module.css';
import { mainAndInstancesOf, useBoardChanges } from './use-board-changes.js';

/** The longest name a main takes (`componentObjectSchema`). */
const MAX_NAME_LENGTH = 200;

/**
 * How many instances a main has, in words: "1 instance", "3 instances".
 *
 * @param count - How many.
 * @returns The words.
 */
function instanceCount(count: number): string {
  return count === 1 ? '1 instance' : `${String(count)} instances`;
}

/**
 * The inspector's component section for a main (ruling 4): its name, renamed when the
 * field is committed (`renameFrame`, one undo step), how many instances it has across the whole
 * board, and "Place instance", which places one to its right and selects it. For several mains
 * it speaks of the first. The panel disables it for a person who cannot edit and for a locked
 * main.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function ComponentSection(props: StylePanelSectionProps): ReactElement | null {
  const { selection, dispatch } = props;
  const main = selection.find((object) => object.type === 'component');
  const board = props.definitions ?? props.board;
  // Its instances may be on other pages, whose changes the panel's feed does not tell.
  const mainId = main?.type === 'component' ? main.id : undefined;
  useBoardChanges(props.watchDefinitions, board, mainAndInstancesOf, mainId);
  if (main?.type !== 'component') return null;
  const count = board.references.instancesOf(main.id).size;
  return (
    <div className={styles.body}>
      <TextFieldControl
        label="Name"
        value={main.name}
        maxLength={MAX_NAME_LENGTH}
        onCommit={(name) => {
          dispatch({ type: 'component', command: 'rename', id: main.id, name });
        }}
      />
      <div className={styles.main}>
        <p className={styles.caption}>{instanceCount(count)}</p>
        <button
          type="button"
          className={controls.button}
          onClick={() => {
            dispatch({ type: 'component', command: 'placeInstance', id: main.id });
          }}
        >
          Place instance
        </button>
      </div>
    </div>
  );
}

/** The inspector's component section: shown when only mains are selected. */
export const stylePanelSection: StylePanelSection = {
  id: 'component',
  title: 'Component',
  context: 'component',
  order: 5,
  isSelectionOnly: true,
  render: ComponentSection,
};
