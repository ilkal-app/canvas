import { useId, type ReactElement } from 'react';

import type { BoardView } from '../../engine/board-view.js';
import { COMPONENT_DRAG_TYPE } from '../../engine/component-drop.js';
import { Icon } from '../../icons/icon.js';
import type { ShellAction } from '../../state/shell-action.js';

import styles from './components-panel.module.css';
import { useComponentList } from './use-component-list.js';

/** Props of {@link ComponentsPanel}. */
export interface ComponentsPanelProps {
  /** The board view, or undefined before an engine mounts. */
  readonly view: BoardView | undefined;
  /** The shell's dispatch, for going to a main and placing an instance. */
  readonly dispatch: (action: ShellAction) => void;
  /** Whether the person may edit: a viewer gets the list alone. True if absent. */
  readonly canEdit?: boolean;
}

/**
 * The components panel (ruling 3), at the top of the layers panel: every live main on
 * the board, by page then paint order (`componentListOf`), each row its name and page. A click
 * goes to the main (its page shown, selected, zoomed to); "Place" places an instance at the
 * centre of the view on the page shown and selects it (`placeInstanceAt`); dragging a row onto
 * the canvas places one at the drop point (`bindComponentDrop`). A person who cannot edit gets
 * the list alone: no Place, no drag. Nothing shows while the board has no main.
 *
 * @param props - The board view, the dispatch and whether the person may edit.
 * @returns The panel, or nothing.
 */
export function ComponentsPanel(props: ComponentsPanelProps): ReactElement | null {
  const { dispatch, canEdit = true } = props;
  const items = useComponentList(props.view);
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby={headingId} data-components-panel="">
      <h3 id={headingId} className={styles.heading}>
        Components
      </h3>
      <ul className={styles.list} aria-labelledby={headingId}>
        {items.map((item) => (
          <li
            key={item.id}
            className={styles.row}
            draggable={canEdit}
            onDragStart={(event) => {
              event.dataTransfer.setData(COMPONENT_DRAG_TYPE, item.id);
              event.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <button
              type="button"
              className={styles.go}
              aria-label={`${item.name}, on ${item.pageName}`}
              aria-describedby={
                item.axes === undefined ? undefined : `${headingId}-${item.id}-axes`
              }
              title="Go to main"
              onClick={() => {
                dispatch({ type: 'component', command: 'goToMain', id: item.id });
              }}
            >
              <Icon name="component" />
              <span className={styles.name}>{item.name}</span>
              {item.axes !== undefined && (
                <span id={`${headingId}-${item.id}-axes`} className={styles.axes}>
                  {item.axes}
                </span>
              )}
              <span className={styles.page}>{item.pageName}</span>
            </button>
            {canEdit && (
              <button
                type="button"
                className={styles.place}
                aria-label={`Place ${item.name}`}
                onClick={() => {
                  dispatch({ type: 'component', command: 'placeInstanceAt', id: item.id });
                }}
              >
                Place
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
