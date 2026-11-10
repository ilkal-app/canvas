import type { ReactElement, ReactNode } from 'react';

import { LOADING_LIVE_BOARD_SUBTITLE } from '../collab/connection-label.js';

import { BoardMenu, type BoardMenuEntry, type BoardMenuProps } from './board-menu.js';
import type { FloatingBoardMenuHost } from './floating-board-menu.js';
import styles from './top-bars.module.css';

/** What a host puts in the board-name bar (the site's board page); every part optional. */
export interface BoardBarContent {
  /** The way home (the site's link to the board list); none if absent. */
  readonly home?: ReactNode;
  /** The title (the site's, with Rename for the owner); the shell's board name if absent. */
  readonly title?: ReactNode;
  /** A line under the title (the site's "View only"); nothing if absent. */
  readonly badge?: ReactNode;
  /** The host's entries of the board menu (the site's History), before the shell's. */
  readonly menuEntries?: readonly BoardMenuEntry[];
  /**
   * Where the floating board bar's "All boards" goes (the site's board list); no Home
   * in that bar if absent.
   */
  readonly homeHref?: string;
  /**
   * What the floating board bar's "All boards" link shows (the site's Boards tile); a home icon
   * if absent.
   */
  readonly homeMark?: ReactNode;
  /** Goes to `homeHref` within the page (the site's navigation) on a plain click. */
  readonly onNavigateHome?: () => void;
  /**
   * What the floating board menu may do: rename, version history, share, board
   * settings, delete; an absent action hides its item. None outside a site.
   */
  readonly floatingMenu?: FloatingBoardMenuHost | undefined;
  /**
   * When the board's content was last edited, as its record says (ISO 8601; the site's
   * `editedAt`, else when it was made): the floating board bar's "Edited …" until this
   * session sees an edit. None if absent or null.
   */
  readonly editedAt?: string | null | undefined;
}

/** Props of {@link BoardNameBar}. */
export interface BoardNameBarProps extends Omit<BoardMenuProps, 'entries'> {
  /** The host's content. */
  readonly content: BoardBarContent | undefined;
  /** The title shown when the host gives none: the board's name or id. */
  readonly fallbackTitle: string;
  /**
   * Whether the live board is loading while the device's copy shows (`isLoadingLiveBoard`,
   *): a subtitle then reads "Saved copy · loading the live board…", the host's
   * badge (the site's "View only") after it. False if absent.
   */
  readonly isLoadingLiveBoard?: boolean;
  /**
   * The line under the name in the compact top bar below 768 px wide (the design's "Live
   * · 3 here": `compactStatusOf`), shown only at that width, where it replaces the loading
   * subtitle; none if absent.
   */
  readonly compactStatus?: string | undefined;
}

/**
 * The board-name bar (the design's "board bar"): a 261 px sheet floating over the
 * canvas's top-left corner with the way home flush with its left edge, the board's title in the
 * title style, centred (no mode line under it: the dock's switcher shows the mode), and
 * under it anything the host adds (the site's "View only"), then the board menu (`BoardMenu`:
 * grid, snapping, the shortcut sheet and the theme) flush with its right edge. The layers drawer
 * and the zoom rule are placed against it. While the live board loads a
 * subtitle reads "Saved copy · loading the live board…" and the bar widens to hold it. Below
 * 768 px wide it is the left part of the compact top bar, its line under the name the
 * connection's state and who is here (`compactStatus`).
 *
 * @param props - The host's content, the fallback title, and the menu's toggles and handlers.
 * @returns The bar.
 */
export function BoardNameBar(props: BoardNameBarProps): ReactElement {
  const { content, fallbackTitle, isLoadingLiveBoard = false, compactStatus, ...menu } = props;
  const hasSubtitle = (content?.badge ?? null) !== null;
  return (
    <div
      role="group"
      aria-label="Board"
      className={styles.boardBar}
      data-top-bar="board"
      data-loading-live={isLoadingLiveBoard ? '' : undefined}
    >
      {content?.home}
      <div className={styles.title}>
        {content?.title ?? <span className={styles.titleText}>{fallbackTitle}</span>}
        {hasSubtitle || isLoadingLiveBoard ? (
          <div className={styles.subtitle}>
            {isLoadingLiveBoard ? (
              <span className={`${styles.badge ?? ''} ${styles.loadingBadge ?? ''}`}>
                {LOADING_LIVE_BOARD_SUBTITLE}
              </span>
            ) : null}
            {content?.badge}
          </div>
        ) : null}
        {compactStatus === undefined ? null : (
          <p className={styles.compactStatus}>{compactStatus}</p>
        )}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <BoardMenu {...menu} entries={content?.menuEntries} />
    </div>
  );
}
