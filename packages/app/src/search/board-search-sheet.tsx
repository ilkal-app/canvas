import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { FloatingSheet } from '../controls/floating-sheet.js';
import type { BoardView } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { Icon } from '../icons/icon.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import { usePages } from '../pages/use-pages.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import type { ShellAction } from '../state/shell-action.js';

import { BoardSearchResults, searchOptionId, useActiveInView } from './board-search-results.js';
import styles from './board-search-sheet.module.css';
import { nextActiveIndex } from './search-results.js';
import { useSearchFieldFocus } from './use-search-field-focus.js';
import { useSearchHighlights } from './use-search-highlights.js';
import { useSearchRows } from './use-search-rows.js';

/** The footer's keys, as frame B words them. */
const FOOTER = '↑↓ to move · ↵ to zoom to it · esc to close';

/** What board search searches: the engine's board and its pages, none before it mounts. */
export interface BoardSearchSource {
  /** The engine's board view, the board searched. */
  readonly view: BoardView | undefined;
  /** The board's pages: the one shown is searched unless All pages is on. */
  readonly pages: PageNavigation | undefined;
  /** The engine, which outlines the objects found while the sheet is open. */
  readonly engine?: Pick<MountedEngine, 'showSearchHighlights'> | undefined;
}

/** Props of {@link BoardSearchSheet}. */
export interface BoardSearchSheetProps extends BoardSearchSource {
  /** The board bar, which the sheet sits 8 px under, at its left edge. */
  readonly barRef: RefObject<HTMLElement | null>;
  /** Changes when focus should move into the field again (mod+f while open). */
  readonly focusRequest: number;
  /**
   * The shell's dispatch, which goes to a result: an object's page, selection and zoom
   * (`goToMain`), a comment pin's frame.
   */
  readonly dispatch: (action: ShellAction) => void;
  /** Closes the sheet (Esc). */
  readonly onClose: () => void;
}

/**
 * Where the sheet sits: 8 px under the bar, at its left edge (frame B).
 *
 * @param barRef - The bar.
 * @returns The sheet's position, fixed to the viewport.
 */
function useUnderBar(barRef: RefObject<HTMLElement | null>): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const box = barRef.current?.getBoundingClientRect();
    if (box !== undefined) setStyle({ left: box.left, top: box.bottom + 8 });
  }, [barRef]);
  return style;
}

/**
 * A switch of what is searched (not in frame B): All pages, off for the page shown; Resolved,
 * on to search resolved comment threads too. A press keeps focus in the field.
 *
 * @param props - Its name, whether it is on and its handler.
 * @param props.label - Its name.
 * @param props.isOn - Whether it is on.
 * @param props.onChange - Receives the new state.
 * @returns The switch.
 */
function ScopeSwitch(props: {
  readonly label: string;
  readonly isOn: boolean;
  readonly onChange: (isOn: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.isOn}
      className={styles.scope}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onChange(!props.isOn);
      }}
    >
      {props.label}
    </button>
  );
}

/** Props of {@link SearchScopes}. */
interface SearchScopesProps {
  /** Whether every page is searched. */
  readonly isAllPages: boolean;
  /** Whether resolved comment threads are searched; no switch without comments. */
  readonly shouldIncludeResolved: boolean | undefined;
  /** Receives All pages' new state. */
  readonly onAllPages: (isOn: boolean) => void;
  /** Receives Resolved's new state. */
  readonly onResolved: (isOn: boolean) => void;
  /** Called after either changes, to take focus back to the field. */
  readonly onChanged: () => void;
}

/**
 * What is searched: All pages and, on a signed-in board, Resolved. Changing either takes focus
 * back to the field, so the keys go on working.
 *
 * @param props - Their states and handlers.
 * @returns The switches.
 */
function SearchScopes(props: SearchScopesProps): ReactElement {
  return (
    <div className={styles.footerRow}>
      <ScopeSwitch
        label="All pages"
        isOn={props.isAllPages}
        onChange={(isOn) => {
          props.onAllPages(isOn);
          props.onChanged();
        }}
      />
      {props.shouldIncludeResolved === undefined ? null : (
        <ScopeSwitch
          label="Resolved"
          isOn={props.shouldIncludeResolved}
          onChange={(isOn) => {
            props.onResolved(isOn);
            props.onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * The board search sheet (design board, Whiteboard frame B), under the floating board
 * bar: a query field with the number of results, the results grouped as stickies, text,
 * sections and, on a signed-in board, comments, each row its text and its section or age, and
 * the keys in the footer. Focus stays in the
 * field: ↑↓ move the active result (`aria-activedescendant`), Enter or a click goes to it and
 * keeps the sheet open, Esc closes it. The page shown is searched; All pages (not in frame B)
 * searches every page, and going to a result on another page shows that page first; Resolved
 * (not in frame B either) adds resolved comment threads. A comment result opens its thread's
 * card at the pin.
 *
 * @param props - The bar, the board, its pages and the handlers.
 * @returns The sheet.
 */
export function BoardSearchSheet(props: BoardSearchSheetProps): ReactElement {
  const [query, setQuery] = useState('');
  const [isAllPages, setAllPages] = useState(false);
  const [shouldIncludeResolved, setShouldIncludeResolved] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { current } = usePages(props.pages);
  const pageId = isAllPages ? undefined : current;
  const rows = useSearchRows(props, { query, pageId, shouldIncludeResolved });
  const { groups, hasComments } = rows;
  const ordered = groups.flatMap((group) => group.rows);
  const active = ordered.length === 0 ? -1 : Math.min(activeIndex, ordered.length - 1);
  useEffect(() => {
    setActiveIndex(0);
  }, [query, isAllPages, shouldIncludeResolved, current]);
  useActiveInView(listId, active);
  useSearchHighlights(props, rows.objectHits, current, ordered[active], inputRef);
  const fieldFocus = useSearchFieldFocus(inputRef, props.focusRequest);
  const goTo = (index: number): void => {
    const row = ordered[index];
    if (row === undefined) return;
    setActiveIndex(index);
    fieldFocus.follow(row.threadId, row.go());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isImeKey(event.nativeEvent)) return;
    if (event.key === 'Escape') props.onClose();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      setActiveIndex(nextActiveIndex(active, event.key === 'ArrowDown' ? 1 : -1, ordered.length));
    } else if (event.key === 'Enter' && event.target === inputRef.current) goTo(active);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const isBlank = query.trim() === '';
  return (
    <FloatingSheet
      shape="stack"
      role="dialog"
      label="Search board"
      className={styles.sheet}
      style={useUnderBar(props.barRef)}
      onKeyDown={onKeyDown}
    >
      <div className={styles.field}>
        <Icon name="search" />
        <input
          ref={inputRef}
          type="search"
          className={styles.input}
          aria-label="Search board"
          aria-controls={listId}
          aria-activedescendant={active < 0 ? undefined : searchOptionId(listId, active)}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <span role="status" className={styles.count}>
          {isBlank ? '' : String(ordered.length)}
        </span>
      </div>
      <BoardSearchResults id={listId} groups={groups} active={active} onGoTo={goTo} />
      {!isBlank && ordered.length === 0 ? <p className={styles.empty}>No results</p> : null}
      <SearchScopes
        isAllPages={isAllPages}
        shouldIncludeResolved={hasComments ? shouldIncludeResolved : undefined}
        onAllPages={setAllPages}
        onResolved={setShouldIncludeResolved}
        onChanged={() => {
          inputRef.current?.focus();
        }}
      />
      <p className={styles.footer}>{FOOTER}</p>
    </FloatingSheet>
  );
}
