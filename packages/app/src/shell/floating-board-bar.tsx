import {
  useCallback,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { FloatingSheet } from '../controls/floating-sheet.js';
import type { BoardExporter } from '../export/run-export.js';
import { Icon } from '../icons/icon.js';
import { isPlainClick } from '../links/plain-click.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import {
  AddPageButton,
  PagesSheet,
  PagesTrigger,
  type PageListSource,
} from '../pages/page-switcher.js';
import { usePages } from '../pages/use-pages.js';
import { BoardSearchButton } from '../search/board-search-button.js';
import type { BoardSearchSource } from '../search/board-search-sheet.js';
import type { ShellAction } from '../state/shell-action.js';

import type { BoardNameBarProps } from './board-name-bar.js';
import { editedAgo } from './edited-ago.js';
import styles from './floating-board-bar.module.css';
import { FloatingBoardMenuButton } from './floating-board-menu-button.js';
import type { FloatingMenuPages } from './floating-board-menu.js';
import type { HelpLinks } from './help-links.js';
import { useIsMobileSite } from './mobile-site.js';
import { useLastEdit, useMinuteClock, type EditSource, type LastEdit } from './use-last-edit.js';

/** Props of {@link FloatingBoardBar}. */
export interface FloatingBoardBarProps extends Omit<
  BoardNameBarProps,
  'isLoadingLiveBoard' | 'compactStatus'
> {
  /** The board's store and status, whose edits the subtitle follows; none for a local document. */
  readonly board: EditSource | undefined;
  /** The board and pages Search searches; no results without them. */
  readonly search?: BoardSearchSource | undefined;
  /** What the board menu's Export exports with; no Export if absent. */
  readonly exporter?: BoardExporter | undefined;
  /**
   * What the bar's pages work with besides `search`'s pages: the role, the selection and
   * the notice; no pages in the bar if absent.
   */
  readonly pageList?: PageListSource | undefined;
  /** Where the board menu's Help and feedback goes; none if absent. */
  readonly helpLinks?: HelpLinks | undefined;
}

/**
 * The line under the board's name (the mode stays internal): when the board was last
 * edited, by whom once this session has seen the edit ("Edited 2 minutes ago by You"), else as
 * the board's record says ("Edited yesterday"); nothing for a board never edited.
 *
 * @param lastEdit - The last edit this session has seen, if any.
 * @param editedAt - When the board's record says it was last edited (ISO 8601), if known.
 * @param now - The time now.
 * @returns The line, or undefined when there is nothing to say.
 */
export function boardBarSubtitle(
  lastEdit: LastEdit | undefined,
  editedAt: string | null | undefined,
  now: number,
): string | undefined {
  if (lastEdit !== undefined) {
    const by = lastEdit.by === undefined ? '' : ` by ${lastEdit.by}`;
    return `Edited ${editedAgo(lastEdit.at, now)}${by}`;
  }
  const recorded = typeof editedAt === 'string' ? Date.parse(editedAt) : Number.NaN;
  return Number.isNaN(recorded) ? undefined : `Edited ${editedAgo(recorded, now)}`;
}

/**
 * All boards' plain click: the host's `onNavigateHome` in place of following the link.
 *
 * @param event - The click.
 * @param onNavigateHome - Goes to all boards; the link is followed if absent.
 */
function goHome(
  event: MouseEvent<HTMLAnchorElement>,
  onNavigateHome: (() => void) | undefined,
): void {
  if (onNavigateHome === undefined || !isPlainClick(event)) return;
  event.preventDefault();
  onNavigateHome();
}

/** The bar's pages: the list's state, the menu's page items and the page shown's name. */
interface BarPages {
  /** Whether the page list is open. */
  readonly isOpen: boolean;
  /** Opens or closes it (the page dropdown). */
  readonly onToggle: () => void;
  /** Closes it (the same function every render). */
  readonly close: () => void;
  /** The board menu's page items; none without pages. */
  readonly menuItems: FloatingMenuPages | undefined;
  /** The page shown's name from two pages on, which the page dropdown shows. */
  readonly shownName: string | undefined;
}

/**
 * The bar's pages: the list closes once one page is left; on the compact bar, from two
 * pages on, the board menu's Pages opens it too.
 *
 * @param navigation - The pages, or undefined before an engine mounts.
 * @param list - The role, the selection and the notice; no pages if absent.
 * @param isCompact - Whether the bar is the phone's compact one.
 * @returns The state.
 */
function useBarPages(
  navigation: PageNavigation | undefined,
  list: PageListSource | undefined,
  isCompact: boolean,
): BarPages {
  const { pages, current } = usePages(navigation);
  const [isOpen, setOpen] = useState(false);
  const hasMany = pages.length > 1;
  if (isOpen && !hasMany) setOpen(false);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  return {
    isOpen: isOpen && hasMany,
    onToggle: () => {
      setOpen((wasOpen) => !wasOpen);
    },
    close,
    menuItems:
      navigation === undefined || list === undefined
        ? undefined
        : {
            onOpen:
              isCompact && hasMany
                ? () => {
                    setOpen(true);
                  }
                : undefined,
            count: pages.length,
          },
    shownName: hasMany ? pages.find((page) => page.id === current)?.name : undefined,
  };
}

/**
 * The bar's end: after the board menu, Add page on a one-page board, else the page
 * dropdown; and the page list while it is open.
 *
 * @param props - The bar, the pages, their state, the role, the dispatch and the width.
 * @param props.barRef - The board bar.
 * @param props.isCompact - Whether the bar is the phone's compact one.
 * @param props.pages - The list's state.
 * @param props.pageList - The role, the selection and the notice.
 * @param props.navigation - The pages, or undefined before an engine mounts.
 * @param props.dispatch - The shell's dispatch, whose undo a deletion's notice runs.
 * @returns The controls.
 */
function PagesAtEnd(props: {
  readonly barRef: RefObject<HTMLDivElement | null>;
  readonly isCompact: boolean;
  readonly pages: BarPages;
  readonly pageList: PageListSource;
  readonly navigation: PageNavigation | undefined;
  readonly dispatch: (action: ShellAction) => void;
}): ReactElement {
  const { barRef, isCompact, pages, pageList, navigation } = props;
  return (
    <>
      {pages.shownName === undefined ? (
        <AddPageButton
          pages={navigation}
          canEdit={pageList.canEdit}
          compactClassName={isCompact ? styles.iconButton : undefined}
        />
      ) : (
        <PagesTrigger name={pages.shownName} isOpen={pages.isOpen} onToggle={pages.onToggle} />
      )}
      {pages.isOpen ? (
        <PagesSheet
          {...{ barRef, isCompact }}
          pages={navigation}
          source={pageList}
          dispatch={props.dispatch}
          onClose={pages.close}
        />
      ) : null}
    </>
  );
}

/**
 * The floating board bar (design board, Whiteboard frame A): a 44 px sheet over the
 * canvas's top-left corner, 16 px in, holding the way to all boards (the Boards tile:
 * the host's `homeHref`, a plain click through `onNavigateHome`), the board's name in a 150 px
 * column (the host's title, else the fallback, cut with an ellipsis and whole in its tooltip)
 * over when it was last edited,
 * Search (`BoardSearchSheet`: the button or mod+f opens it) and the board menu
 * (`FloatingBoardMenuButton`). Under the floating chrome at every width: below 768 px
 * it is compact, flat inside the compact top bar, its targets 48 px, and Search moves
 * into the board menu. Its pages: one control last, after the
 * board menu: on a one-page board Add page (`AddPageButton`, its glyph alone on the compact bar),
 * from two pages on the page dropdown (`PagesTrigger`, the page shown's name), which drops the
 * page list down (`PagesSheet`, whose last row adds a page).
 *
 * @param props - The host's content, the fallback title, the menu's props and the board.
 * @returns The bar.
 */
export function FloatingBoardBar(props: FloatingBoardBarProps): ReactElement {
  const { content, fallbackTitle, board, search, exporter, pageList, helpLinks, ...menu } = props;
  const lastEdit = useLastEdit(board);
  const editedAt = content?.editedAt;
  const now = useMinuteClock(lastEdit !== undefined || typeof editedAt === 'string');
  const barRef = useRef<HTMLDivElement>(null);
  const isCompact = useIsMobileSite();
  const pages = useBarPages(search?.pages, pageList, isCompact);
  const subtitle = boardBarSubtitle(lastEdit, editedAt, now);
  return (
    <FloatingSheet
      ref={barRef}
      shape="bar"
      role="group"
      label="Board"
      className={styles.bar}
      dataAttributes={{ 'data-top-bar': 'board', ...(isCompact ? { 'data-compact': '' } : {}) }}
    >
      {content?.homeHref === undefined ? null : (
        <a
          className={styles.iconButton}
          href={content.homeHref}
          aria-label="All boards"
          title="All boards"
          onClick={(event) => {
            goHome(event, content.onNavigateHome);
          }}
        >
          {content.homeMark ?? <Icon name="home" />}
        </a>
      )}
      <div className={styles.title}>
        {content?.title ?? (
          <h1 className={styles.name} title={fallbackTitle}>
            {fallbackTitle}
          </h1>
        )}
        {subtitle === undefined ? null : <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <BoardSearchButton
        barRef={barRef}
        search={search}
        requests={menu.state.boardSearchRequests}
        dispatch={menu.dispatch}
        className={styles.iconButton}
        isCompact={isCompact}
      />
      <FloatingBoardMenuButton
        barRef={barRef}
        host={content?.floatingMenu}
        onNavigateHome={content?.onNavigateHome}
        themePreference={menu.themePreference}
        onThemeChange={menu.onThemeChange}
        dispatch={menu.dispatch}
        className={styles.iconButton}
        isCompact={isCompact}
        pages={search?.pages}
        exporter={exporter}
        pageItems={pages.menuItems}
        help={helpLinks}
      />
      {pageList === undefined ? null : (
        <PagesAtEnd
          {...{ barRef, isCompact, pages, pageList }}
          navigation={search?.pages}
          dispatch={menu.dispatch}
        />
      )}
    </FloatingSheet>
  );
}
