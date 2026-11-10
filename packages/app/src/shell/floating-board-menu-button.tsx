import { useContext, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';

import {
  commentsPendingContext,
  useCommentMode,
  type CommentMode,
} from '../comments/comment-context.js';
import { commentDataContext, type CommentData } from '../comments/comment-data-context.js';
import { nextUnreadOf } from '../comments/comment-unread.js';
import { Menu, type MenuCloseReason } from '../controls/menu.js';
import type { ScreenRect } from '../controls/placement.js';
import { exportBoardPdf } from '../export/export-pdf.js';
import { exportBoardPng, exportRequestOf, type BoardExporter } from '../export/run-export.js';
import { Icon } from '../icons/icon.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import { goToComment, type SearchRowsSource } from '../search/use-search-rows.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ThemePreference } from '../theme/theme-preference.js';

import {
  floatingBoardMenuEntries,
  type FloatingBoardExport,
  type FloatingBoardMenuHost,
  type FloatingMenuComments,
  type FloatingMenuPages,
} from './floating-board-menu.js';
import type { HelpLinks } from './help-links.js';
import { useShellDrawers } from './shell-board-mode.js';

/** Props of {@link FloatingBoardMenuButton}. */
export interface FloatingBoardMenuButtonProps {
  /** The board bar, whose bottom the menu opens 6 px below. */
  readonly barRef: RefObject<HTMLElement | null>;
  /** The host's actions; none outside a site. */
  readonly host: FloatingBoardMenuHost | undefined;
  /** Goes to all boards; no All boards if absent. */
  readonly onNavigateHome: (() => void) | undefined;
  /** The person's theme preference. */
  readonly themePreference: ThemePreference;
  /** Changes it. */
  readonly onThemeChange: (preference: ThemePreference) => void;
  /** The shell's dispatch, which opens the shortcut sheet. */
  readonly dispatch: (action: ShellAction) => void;
  /** The button's class (the bar's 28 px icon button). */
  readonly className: string | undefined;
  /** Whether the bar is the phone's compact one, whose menu holds Search board. */
  readonly isCompact?: boolean | undefined;
  /** The board's pages, which going to an unread comment shows; none if absent. */
  readonly pages?: PageNavigation | undefined;
  /** What Export exports with; no Export if absent. */
  readonly exporter?: BoardExporter | undefined;
  /** The page item: the compact bar's Pages; none if absent. */
  readonly pageItems?: FloatingMenuPages | undefined;
  /** Where Help and feedback goes, the host's links; no Help and feedback if absent. */
  readonly help?: HelpLinks | undefined;
}

/**
 * Opens an address from the menu: in a new tab without a way back to this page, or in place (a
 * `mailto:` hands over to the mail app).
 *
 * @param url - The address.
 * @param isNewTab - Whether to open it in a new tab.
 */
function openUrl(url: string, isNewTab: boolean): void {
  if (isNewTab) window.open(url, '_blank', 'noopener');
  else window.location.assign(url);
}

/**
 * Where the menu opens from: ⋯'s left and right edges, the bar's top and bottom, so the menu sits
 * 6 px below the bar with its right edge on ⋯'s (design frame C).
 *
 * @param button - ⋯.
 * @param bar - The board bar.
 * @returns The anchor rectangle.
 */
function anchorOf(button: Element, bar: Element | null): ScreenRect {
  const buttonBox = button.getBoundingClientRect();
  const barBox = (bar ?? button).getBoundingClientRect();
  return { x: buttonBox.left, y: barBox.top, width: buttonBox.width, height: barBox.height };
}

/**
 * Whether the press now ending on ⋯ began while the menu was open: the menu closes on that
 * press as one outside it (its pointerdown listener, on the document's capture), so the click
 * that follows must close, not open again. Read on the window's capture, which runs first; a
 * press that ends without that click clears it.
 *
 * @param buttonRef - ⋯.
 * @param isOpen - Whether the menu is open.
 * @returns The flag, which the click resets.
 */
function useWasOpenAtPress(
  buttonRef: RefObject<HTMLButtonElement | null>,
  isOpen: boolean,
): RefObject<boolean> {
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && buttonRef.current?.contains(event.target) === true) {
        wasOpenRef.current = true;
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [buttonRef, isOpen]);
  useEffect(() => {
    // A press that ends away from ⋯ (dragged off) or is cancelled makes no click on it, so it
    // must not leave the flag set for the next click or key.
    const onPressEnd = (event: PointerEvent): void => {
      const isOnButton =
        event.type === 'pointerup' &&
        event.target instanceof Node &&
        buttonRef.current?.contains(event.target) === true;
      if (!isOnButton) wasOpenRef.current = false;
    };
    window.addEventListener('pointerup', onPressEnd, true);
    window.addEventListener('pointercancel', onPressEnd, true);
    return () => {
      window.removeEventListener('pointerup', onPressEnd, true);
      window.removeEventListener('pointercancel', onPressEnd, true);
    };
  }, [buttonRef]);
  return wasOpenRef;
}

/**
 * The menu's comment input from the site's comments: resolved pins' toggle, where the
 * mode has one; and the unread threads' count, whose entry goes to the next unread thread (a
 * mention first) as a search result goes to a comment: its page shown, its pin framed, its card
 * open.
 *
 * @param mode - The comment mode, on a board with site comments.
 * @param data - The comments, whose threads and person the next unread thread is read from.
 * @param source - The pages and the dispatch that going to a thread uses.
 * @returns The input, or undefined.
 */
function commentsOf(
  mode: CommentMode | undefined,
  data: CommentData | undefined,
  source: Pick<SearchRowsSource, 'pages' | 'dispatch'>,
): FloatingMenuComments | undefined {
  const toggle = mode?.toggleResolvedShown;
  if (mode === undefined || toggle === undefined) return undefined;
  const onOpenUnread =
    data === undefined
      ? undefined
      : () => {
          const next = nextUnreadOf(data.threads, data.user.id);
          if (next !== undefined)
            void goToComment({ threadId: next.id, pinId: next.pinId }, data, source);
        };
  return {
    isResolvedShown: mode.isResolvedShown === true,
    onToggleResolved: toggle,
    unread: mode.unread,
    onOpenUnread,
  };
}

/**
 * The menu's Export: the selection when something is selected, else the page shown,
 * read as the menu opens.
 *
 * @param exporter - What the shell exports with, if anything.
 * @returns The menu's export input; `'pending'` while the engine is not mounted yet, or
 *   undefined.
 */
export function exportOf(
  exporter: BoardExporter | undefined,
): FloatingBoardExport | 'pending' | undefined {
  // The engine not mounted yet: Export is on its way, its row kept.
  if (exporter !== undefined && exporter.engine === undefined) return 'pending';
  const request = exportRequestOf(exporter?.engine);
  if (exporter === undefined || request === undefined) return undefined;
  return {
    scope: request.kind === 'selection' ? 'selection' : 'board',
    onExport: (format, scale) => {
      void (format === 'pdf' ? exportBoardPdf(exporter) : exportBoardPng(exporter, scale));
    },
  };
}

/**
 * The floating board bar's ⋯ and its menu (design frame C): the Library's menu
 * (`Menu`) of `floatingBoardMenuEntries`, opening 6 px below the bar, right-aligned with ⋯, which
 * shows its active state while it is open (`aria-expanded`). Choosing an item closes the menu and
 * puts focus back on ⋯ before the item acts.
 *
 * @param props - The bar, the host's actions, the way home, the theme and the dispatch.
 * @returns The button and, when open, the menu.
 */
export function FloatingBoardMenuButton(props: FloatingBoardMenuButtonProps): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<ScreenRect | undefined>(undefined);
  const wasOpenAtPressRef = useWasOpenAtPress(buttonRef, anchor !== undefined);
  const { dispatch } = props;
  const close = (reason: MenuCloseReason): void => {
    setAnchor(undefined);
    if (reason !== 'outside' && reason !== 'tab') buttonRef.current?.focus();
  };
  const commentMode = useCommentMode();
  const isCommentsPending = useContext(commentsPendingContext);
  const commentData = useContext(commentDataContext);
  const { hasInspector } = useShellDrawers();
  const entries = floatingBoardMenuEntries({
    host: props.host,
    onNavigateHome: props.onNavigateHome,
    themePreference: props.themePreference,
    onThemeChange: props.onThemeChange,
    onKeyboardShortcuts: () => {
      dispatch({ type: 'toggleCheatSheet' });
    },
    openUrl,
    help: props.help,
    isCompact: props.isCompact,
    onSearch: () => {
      dispatch({ type: 'openBoardSearch' });
    },
    // Only where resolved pins hide: a mode without the right-hand drawer.
    comments: hasInspector
      ? undefined
      : (commentsOf(commentMode, commentData, { pages: props.pages, dispatch }) ??
        // Comments on their way (the board not connected yet): their row kept.
        (isCommentsPending ? 'pending' : undefined)),
    export: exportOf(props.exporter),
    pages: props.pageItems,
  });
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={props.className}
        aria-label="Board menu"
        title="Board menu"
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        onClick={(event) => {
          const wasOpen = wasOpenAtPressRef.current || anchor !== undefined;
          wasOpenAtPressRef.current = false;
          if (wasOpen) setAnchor(undefined);
          else setAnchor(anchorOf(event.currentTarget, props.barRef.current));
        }}
      >
        <Icon name="more" />
      </button>
      {anchor === undefined ? null : (
        <Menu
          label="Board menu"
          entries={entries}
          anchor={anchor}
          isOpen
          side="bottom"
          align="end"
          gap={6}
          onClose={close}
        />
      )}
    </>
  );
}
