import { useRef, useState, type ReactElement, type RefObject } from 'react';

import { Icon } from '../icons/icon.js';
import type { ShellAction } from '../state/shell-action.js';

import { BoardSearchSheet, type BoardSearchSource } from './board-search-sheet.js';

/** Props of {@link BoardSearchButton}. */
export interface BoardSearchButtonProps {
  /** The board bar, which the sheet opens under. */
  readonly barRef: RefObject<HTMLElement | null>;
  /** The board and pages searched; no results without them. */
  readonly search: BoardSearchSource | undefined;
  /**
   * How many times mod+f asked for the sheet (`ShellState.boardSearchRequests`): it opens, or
   * takes focus into its field again, when this changes.
   */
  readonly requests: number;
  /** The shell's dispatch, which goes to a result. */
  readonly dispatch: (action: ShellAction) => void;
  /** The bar's icon button class. */
  readonly className: string | undefined;
  /**
   * Whether the bar is the phone's compact one: no button (the board menu's Search
   * board opens the sheet, by mod+f's request), and Esc gives focus to the board menu's button.
   */
  readonly isCompact?: boolean | undefined;
}

/**
 * The floating board bar's Search: a toggle for the board search sheet
 * (`BoardSearchSheet`), open while pressed (`aria-expanded`); mod+f opens it too. Going to a
 * result is `goToMain`'s path, which shows any object's page, selects it and zooms to it; Esc
 * closes the sheet and focus comes back here. On a phone's compact bar it has no button: the
 * board menu's Search board asks for the sheet as mod+f does, and Esc goes back to the menu's
 * button.
 *
 * @param props - The bar, the board, the mod+f requests, the dispatch and the class.
 * @returns The button and, while open, the sheet.
 */
export function BoardSearchButton(props: BoardSearchButtonProps): ReactElement {
  const { dispatch, requests } = props;
  const [isOpen, setOpen] = useState(false);
  const [seenRequests, setSeenRequests] = useState(requests);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (requests !== seenRequests) {
    setSeenRequests(requests);
    setOpen(true);
  }
  return (
    <>
      {props.isCompact === true ? null : (
        <button
          ref={buttonRef}
          type="button"
          className={props.className}
          aria-label="Search board"
          title="Search board"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => {
            setOpen((wasOpen) => !wasOpen);
          }}
        >
          <Icon name="search" />
        </button>
      )}
      {isOpen ? (
        <BoardSearchSheet
          barRef={props.barRef}
          view={props.search?.view}
          pages={props.search?.pages}
          engine={props.search?.engine}
          focusRequest={requests}
          dispatch={dispatch}
          onClose={() => {
            setOpen(false);
            const menuButton = props.barRef.current?.querySelector<HTMLElement>(
              '[aria-label="Board menu"]',
            );
            (props.isCompact === true ? menuButton : buttonRef.current)?.focus();
          }}
        />
      ) : null}
    </>
  );
}
