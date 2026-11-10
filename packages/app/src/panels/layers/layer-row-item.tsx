import { useState, type MouseEvent, type ReactElement } from 'react';

import type { IconName } from '../../icons/icon-paths.js';
import { Icon } from '../../icons/icon.js';

import { LayerNameInput } from './layer-name-input.js';
import type { LayerRow } from './layer-rows.js';
import styles from './layers.module.css';

/** Each row's height, CSS px: the virtualised list places rows by it. */
export const LAYER_ROW_HEIGHT_PX = 28;

/** How far each level of the tree is indented, CSS px. */
export const LAYER_INDENT_PX = 12;

/** The app's shared icon for each stored object type (mains and instances). */
const TYPE_ICONS: Readonly<Record<LayerRow['type'], IconName>> = {
  text: 'text',
  sticky: 'note',
  image: 'image',
  video: 'present',
  shape: 'shapes',
  line: 'line',
  connector: 'connector',
  path: 'pen',
  freehand: 'pencil',
  link: 'link',
  group: 'group',
  frame: 'frame',
  comment: 'comment',
  component: 'component',
  instance: 'instance',
};

/** Props of {@link LayerRowItem}. */
export interface LayerRowItemProps {
  /** The row. */
  readonly row: LayerRow;
  /** Its index in the list, which places it. */
  readonly index: number;
  /** Whether its object is selected. */
  readonly isSelected: boolean;
  /** Whether it is the group the select tool entered; false if absent. */
  readonly isEntered?: boolean;
  /** Whether it is the row keyboard focus lands on (`tabIndex` 0). */
  readonly isFocusTarget: boolean;
  /** A click on the row: select it, or with Shift add it to the selection. */
  readonly onSelect: (row: LayerRow, isAdding: boolean) => void;
  /** The disclosure: expand or collapse the row's children. */
  readonly onToggleExpanded: (row: LayerRow) => void;
  /** The lock button; no button when absent (a person who cannot edit). */
  readonly onToggleLock?: (row: LayerRow) => void;
  /** The visibility button; no button when absent (a person who cannot edit). */
  readonly onToggleHidden?: (row: LayerRow) => void;
  /** The row took focus. */
  readonly onFocus: (index: number) => void;
  /**
   * Renames the row's object (any object since): a double-click on the row edits
   * its name in place and a committed edit calls this. No renaming when absent (a person who cannot edit).
   */
  readonly onRename?: (row: LayerRow, name: string) => void;
}

/**
 * Stops a button's click from also selecting the row, and its double-click from renaming it.
 *
 * @param event - The click.
 */
function keepToButton(event: MouseEvent): void {
  event.stopPropagation();
}

/**
 * A row's name and its in-place rename (any object's since): the name, or while
 * renaming, the input editing it, whose committed name goes to `onRename`. Committing the shown
 * name unchanged (a shape's derived "Rectangle") renames nothing.
 *
 * @param row - The row.
 * @param onRename - Renames the row's object; no renaming when absent.
 * @returns What starts the rename (the row's double-click) and the name's cell.
 */
function useRowRename(
  row: LayerRow,
  onRename: LayerRowItemProps['onRename'],
): { readonly start: () => void; readonly nameCell: ReactElement } {
  const [isRenaming, setRenaming] = useState(false);
  const canRename = onRename !== undefined;
  const finish = (name: string | undefined): void => {
    setRenaming(false);
    if (name !== undefined) onRename?.(row, name);
  };
  return {
    start: () => {
      if (canRename) setRenaming(true);
    },
    nameCell:
      isRenaming && canRename ? (
        <LayerNameInput name={row.name} onDone={finish} />
      ) : (
        <span className={styles.name}>{row.name}</span>
      ),
  };
}

/** Props of {@link RowToggle}. */
interface RowToggleProps {
  /** Its accessible name, the action it takes. */
  readonly label: string;
  /** Whether the state it toggles is on (`aria-pressed`). */
  readonly isPressed: boolean;
  /** The icon it shows. */
  readonly icon: IconName;
  /** Toggles the state. */
  readonly onToggle: () => void;
}

/**
 * A row's toggle button (its lock, or its visibility): out of the tab order, shown on
 * hover or focus and always while pressed, its click kept from selecting or renaming the row.
 *
 * @param props - Its name, state, icon and handler.
 * @returns The button.
 */
function RowToggle(props: RowToggleProps): ReactElement {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={styles.lock}
      onDoubleClick={keepToButton}
      aria-label={props.label}
      aria-pressed={props.isPressed}
      onClick={(event) => {
        keepToButton(event);
        props.onToggle();
      }}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/**
 * One row of the layers tree: a `treeitem` named after the object (`…, locked` when it is), with
 * its level, place among its siblings, selection, whether it is the entered group
 * (`aria-current`) and (for a frame or group with children) expansion, a disclosure
 * button, a visibility toggle and a lock toggle. The buttons are out of the tab order (the tree's keys expand and
 * collapse; mod+shift+l locks the selection) but reachable by pointer and assistive
 * technology. With `onRename`, a double-click on any row edits its object's name in place
 * (`LayerNameInput`): how a frame whose name the canvas does not draw, or a text
 * or shape, is renamed.
 *
 * @param props - The row, its place and state, and the handlers.
 * @returns The row.
 */
export function LayerRowItem(props: LayerRowItemProps): ReactElement {
  const {
    row,
    index,
    isSelected,
    isEntered = false,
    isFocusTarget,
    onToggleLock,
    onToggleHidden,
    onRename,
  } = props;
  const rename = useRowRename(row, onRename);
  return (
    <div
      role="treeitem"
      className={styles.row}
      aria-label={`${row.name}${row.isLocked ? ', locked' : ''}${row.isHidden ? ', hidden' : ''}`}
      data-hidden={row.isHidden ? 'true' : undefined}
      aria-level={row.level}
      aria-posinset={row.positionInSet}
      aria-setsize={row.setSize}
      aria-selected={isSelected}
      aria-current={isEntered ? 'true' : undefined}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      tabIndex={isFocusTarget ? 0 : -1}
      data-index={index}
      data-id={row.id}
      style={{ top: index * LAYER_ROW_HEIGHT_PX, height: LAYER_ROW_HEIGHT_PX }}
      onClick={(event) => {
        props.onSelect(row, event.shiftKey);
      }}
      onFocus={() => {
        props.onFocus(index);
      }}
      onDoubleClick={rename.start}
    >
      <span style={{ width: (row.level - 1) * LAYER_INDENT_PX }} className={styles.indent} />
      {row.hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          className={styles.disclosure}
          onDoubleClick={keepToButton}
          aria-label={`${row.isExpanded ? 'Collapse' : 'Expand'} ${row.name}`}
          onClick={(event) => {
            keepToButton(event);
            props.onToggleExpanded(row);
          }}
        >
          <Icon name={row.isExpanded ? 'chevron-down' : 'chevron-right'} />
        </button>
      ) : (
        <span className={styles.disclosure} />
      )}
      <Icon name={row.shapeKind ?? TYPE_ICONS[row.type]} />
      {rename.nameCell}
      {onToggleHidden !== undefined && (
        <RowToggle
          label={`${row.isHidden ? 'Show' : 'Hide'} ${row.name}`}
          isPressed={row.isHidden}
          icon={row.isHidden ? 'eye-off' : 'eye'}
          onToggle={() => {
            onToggleHidden(row);
          }}
        />
      )}
      {onToggleLock !== undefined && (
        <RowToggle
          label={`${row.isLocked ? 'Unlock' : 'Lock'} ${row.name}`}
          isPressed={row.isLocked}
          icon={row.isLocked ? 'lock' : 'unlock'}
          onToggle={() => {
            onToggleLock(row);
          }}
        />
      )}
    </div>
  );
}
