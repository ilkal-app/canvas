import { useRef, useState, type DragEvent, type ReactElement } from 'react';

import type { Page, PageId } from '@canvas/schema';

import { isImeKey } from '../shortcuts/ime-key.js';

import styles from './pages-panel.module.css';

/** The drag data type of a page row being reordered. */
const PAGE_DRAG_TYPE = 'application/x-canvas-page';

/** Props of {@link PageRow}. */
export interface PageRowProps {
  /** The page. */
  readonly page: Page;
  /** Whether it is the page shown. */
  readonly isCurrent: boolean;
  /** Whether it is being renamed. */
  readonly isRenaming: boolean;
  /** Whether the person may edit the board: no rename, menu or drag otherwise. */
  readonly canEdit: boolean;
  /** Shows the page. */
  readonly onShow: () => void;
  /** Starts renaming it. */
  readonly onStartRename: () => void;
  /** Ends renaming: the new name, or undefined to keep the old one. */
  readonly onRename: (name: string | undefined) => void;
  /** Opens its menu at a point. */
  readonly onMenu: (x: number, y: number) => void;
  /** Moves a dragged page next to this one: before it, or after it. */
  readonly onDropPage: (pageId: PageId, side: 'before' | 'after') => void;
}

/**
 * Which side of a row a drop lands on: its upper half before it, its lower half after.
 *
 * @param event - The drag event.
 * @returns The side.
 */
function sideOf(event: DragEvent<HTMLElement>): 'before' | 'after' {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2 ? 'before' : 'after';
}

/**
 * One page in the page list: its name, the page shown marked (`aria-current="page"`); a click
 * (or Enter, the row focused) shows it; for a person who may edit, a double-click renames it in place (a text box named
 * "Page name": Enter keeps, Escape drops), a secondary click opens its menu, and a drag onto
 * another row reorders it.
 *
 * @param props - The page, its state and its handlers.
 * @returns The row.
 */
export function PageRow(props: PageRowProps): ReactElement {
  const { page, isCurrent, isRenaming, canEdit } = props;
  const [isDropTarget, setDropTarget] = useState(false);
  return (
    <li
      className={styles.row}
      aria-current={isCurrent ? 'page' : undefined}
      data-drop={isDropTarget}
      draggable={canEdit && !isRenaming}
      tabIndex={-1}
      onClick={props.onShow}
      onKeyDown={(event) => {
        // Enter shows the row's page (the dropdown's arrow keys move between rows).
        if (event.key !== 'Enter' || isRenaming) return;
        event.preventDefault();
        props.onShow();
      }}
      onDoubleClick={canEdit ? props.onStartRename : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        if (canEdit) props.onMenu(event.clientX, event.clientY);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
        event.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => {
        setDropTarget(false);
      }}
      onDrop={(event) => {
        setDropTarget(false);
        const dragged = event.dataTransfer.getData(PAGE_DRAG_TYPE);
        if (dragged !== '' && dragged !== page.id)
          props.onDropPage(dragged as PageId, sideOf(event));
      }}
    >
      {isRenaming ? (
        <NameInput name={page.name} onDone={props.onRename} />
      ) : (
        <span className={styles.name}>{page.name}</span>
      )}
    </li>
  );
}

/**
 * The text box renaming a page: focused with its text selected; Enter or leaving it keeps the
 * name, Escape drops it.
 *
 * @param props - The name now and where the result goes.
 * @param props.name - The name now.
 * @param props.onDone - Receives the new name, or undefined to keep the old one.
 * @returns The text box.
 */
function NameInput(props: {
  readonly name: string;
  readonly onDone: (name: string | undefined) => void;
}): ReactElement {
  const [value, setValue] = useState(props.name);
  const doneRef = useRef(false);
  const done = (name: string | undefined): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    props.onDone(name);
  };
  return (
    <input
      className={styles.input}
      aria-label="Page name"
      value={value}
      maxLength={200}
      ref={(input) => {
        if (input === null || document.activeElement === input) return;
        input.focus();
        input.select();
      }}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (isImeKey(event.nativeEvent)) return;
        if (event.key === 'Enter') done(value);
        else if (event.key === 'Escape') done(undefined);
      }}
      onBlur={() => {
        done(value);
      }}
    />
  );
}
