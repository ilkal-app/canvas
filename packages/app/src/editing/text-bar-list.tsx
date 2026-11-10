import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';

import type { TextStyleChange, TextStyleContext } from '../engine/document-text.js';
import { Icon } from '../icons/icon.js';

import styles from './text-bar.module.css';

/** Props of {@link ListControl}. */
export interface ListControlProps {
  /** The list the edited paragraphs share; absent while not editing. */
  readonly list: TextStyleContext['list'];
  /** Applies a change to the edited text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/** The list menu's kinds, in the owner-approved frames' order (A2). */
const KINDS = [
  { list: null, label: 'No list', mark: '—', hint: undefined },
  { list: 'bullet', label: 'Bulleted list', mark: '•', hint: '- space' },
  { list: 'numbered', label: 'Numbered list', mark: '1.', hint: '1. space' },
] as const;

/**
 * Keeps a pointer press from taking the keyboard from the text editor.
 *
 * @param event - The press.
 */
function keepEditorFocus(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * The text bar's list control (frames A2 and M2): a button showing the edited
 * paragraphs' list (a dash when they differ) that opens the list menu: no list, bulleted,
 * numbered (each with its typing shortcut), then indent and outdent, which only a list takes.
 * A choice is one undo step and closes the menu; Escape or a press outside closes it. Below
 * 768 px the menu shows as a sheet over the docked bar (`text-bar.module.css`).
 *
 * @param props - The list and the change callback.
 * @returns The control.
 */
export function ListControl(props: ListControlProps): ReactElement {
  const { list, onChange } = props;
  const [isOpen, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!isOpen) return undefined;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && root.current?.contains(event.target as Node) === true)
        return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close, true);
    };
  }, [isOpen]);
  const choose = (change: TextStyleChange) => {
    onChange(change);
    setOpen(false);
  };
  const isList = list === 'bullet' || list === 'numbered';
  return (
    <span ref={root} className={styles.listControl}>
      <button
        type="button"
        className={styles.item}
        data-text-bar-item=""
        aria-label="List"
        title="List"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-pressed={isList}
        onMouseDown={keepEditorFocus}
        onClick={() => {
          setOpen(!isOpen);
        }}
      >
        {list === 'mixed' ? (
          <span className={styles.listMixed}>—</span>
        ) : (
          <Icon name={list === 'numbered' ? 'list-numbered' : 'list-bullet'} />
        )}
        <Icon name="chevron-down" />
      </button>
      {isOpen && <ListMenu list={list} isList={isList} onChoose={choose} />}
    </span>
  );
}

/** Props of {@link ListMenu}. */
interface ListMenuProps {
  /** The list the edited paragraphs share. */
  readonly list: TextStyleContext['list'];
  /** Whether they are a list, which indent and outdent need. */
  readonly isList: boolean;
  /** Applies a choice and closes the menu. */
  readonly onChoose: (change: TextStyleChange) => void;
}

/**
 * The list menu (frame A2): the three kinds, the chosen one checked, then indent and
 * outdent.
 *
 * @param props - The list and the choice callback.
 * @returns The menu.
 */
function ListMenu(props: ListMenuProps): ReactElement {
  const { list, isList, onChoose: choose } = props;
  return (
    <span className={styles.listMenu} role="menu" aria-label="List">
      <span className={styles.listSheetTitle} aria-hidden="true">
        List
      </span>
      {KINDS.map((kind) => (
        <button
          key={kind.label}
          type="button"
          role="menuitemradio"
          className={styles.listItem}
          aria-checked={(list ?? 'none') === (kind.list ?? 'none')}
          onMouseDown={keepEditorFocus}
          onClick={() => {
            choose({ kind: 'list', list: kind.list });
          }}
        >
          <span className={styles.listMark} aria-hidden="true">
            {kind.mark}
          </span>
          <span className={styles.listLabel}>{kind.label}</span>
          {kind.hint !== undefined && <kbd className={styles.listHint}>{kind.hint}</kbd>}
          <span className={styles.listCheck} aria-hidden="true">
            <Icon name="check" />
          </span>
        </button>
      ))}
      <span className={styles.listLevels}>
        <button
          type="button"
          role="menuitem"
          className={styles.listItem}
          aria-disabled={!isList}
          onMouseDown={keepEditorFocus}
          onClick={() => {
            if (isList) choose({ kind: 'listLevel', delta: 1 });
          }}
        >
          <span className={styles.listMark} aria-hidden="true">
            <Icon name="indent" />
          </span>
          <span className={styles.listLabel}>Indent</span>
          <kbd className={styles.listHint}>Tab</kbd>
        </button>
        <button
          type="button"
          role="menuitem"
          className={styles.listItem}
          aria-disabled={!isList}
          onMouseDown={keepEditorFocus}
          onClick={() => {
            if (isList) choose({ kind: 'listLevel', delta: -1 });
          }}
        >
          <span className={styles.listMark} aria-hidden="true">
            <Icon name="outdent" />
          </span>
          <span className={styles.listLabel}>Outdent</span>
          <kbd className={styles.listHint}>⇧ Tab</kbd>
        </button>
      </span>
    </span>
  );
}
