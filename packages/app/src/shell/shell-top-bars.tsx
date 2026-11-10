import { useRef, type ReactElement } from 'react';

import type { ShellAccount } from '../account/account-menu.js';
import type { ConnectionStatusSource } from '../collab/board-connection.js';
import { isAwayFromRelay, isLoadingLiveBoard } from '../collab/connection-label.js';
import { OfflineBanner } from '../collab/offline-banner.js';
import { PresenceShareBar } from '../collab/presence-share-bar.js';
import { useConnectionStatus } from '../collab/use-connection-status.js';
import type { BoardExporter } from '../export/run-export.js';
import type { PageListSource } from '../pages/page-switcher.js';
import type { BoardSearchSource } from '../search/board-search-sheet.js';

import { BoardNameBar, type BoardNameBarProps } from './board-name-bar.js';
import { compactStatusOf } from './compact-status.js';
import { FloatingBoardBar } from './floating-board-bar.js';
import type { HelpLinks } from './help-links.js';
import { useIsMobileSite } from './mobile-site.js';
import styles from './top-bars.module.css';
import type { EditSource } from './use-last-edit.js';
import { useWheelToCanvas } from './use-wheel-to-canvas.js';
import { useWhiteboardChrome } from './whiteboard-chrome.js';

/**
 * The canvas under the bars: the one in the workspace that holds them.
 *
 * @param bars - The bars' element.
 * @returns The canvas, or null before it mounts.
 */
function canvasBeside(bars: HTMLElement): HTMLCanvasElement | null {
  return bars.parentElement?.querySelector('canvas') ?? null;
}

/**
 * The indeterminate progress line along the workspace's top edge while the live board loads:
 * a 2 px track and a segment running along it; still under reduced motion.
 *
 * @returns The line.
 */
function LiveBoardProgress(): ReactElement {
  return (
    <div role="progressbar" aria-label="Loading the live board" className={styles.progress}>
      <span className={styles.progressSegment} />
    </div>
  );
}

/**
 * Retry now for a connection that can reconnect on request.
 *
 * @param connection - The board's connection.
 * @returns The handler, or undefined.
 */
function retryOf(connection: ConnectionStatusSource | undefined): (() => void) | undefined {
  if (connection?.retryNow === undefined) return undefined;
  return () => {
    connection.retryNow?.();
  };
}

/** Props of {@link ShellTopBars}. */
export interface ShellTopBarsProps extends BoardNameBarProps {
  /**
   * Whether the shell's layout is inert (a dialog is open, the board is loading, the app is out
   * of date): the board-name bar and Share are then out of reach, the connection's state is not.
   */
  readonly isInert: boolean;
  /** The board's connection, for the presence/share bar; none if absent. */
  readonly connection: ConnectionStatusSource | undefined;
  /** Opens the host's share dialog; no Share if absent. */
  readonly onShare: (() => void) | undefined;
  /** Copies the board's link from the bar's Copy link. */
  readonly onCopyLink?: (() => void) | undefined;
  /** A page's name from its id, so the people say where they are; none if absent. */
  readonly pageNameOf?: (pageId: string) => string | undefined;
  /** The signed-in person, whose account button ends the presence/share bar. */
  readonly account?: ShellAccount | undefined;
  /**
   * The board's store and status, whose edits the floating board bar's subtitle follows;
   * none for the engine's local document.
   */
  readonly board?: EditSource | undefined;
  /** The board and pages the floating board bar's search searches; none if absent. */
  readonly search?: BoardSearchSource | undefined;
  /** What the floating board menu's Export exports with; none if absent. */
  readonly exporter?: BoardExporter | undefined;
  /** What the floating board bar's pages work with; no pages in the bar if absent. */
  readonly pageList?: PageListSource | undefined;
  /** Where the floating board menu's Help and feedback goes; none if absent. */
  readonly helpLinks?: HelpLinks | undefined;
}

/**
 * The shell's two top bars over the canvas: the board-name bar (`BoardNameBar`) at
 * the top left and the presence/share bar (`PresenceShareBar`) at the top right, first in the
 * tab order of the canvas area. They float: the canvas keeps its size and place beneath them.
 * The presence/share bar shows with a connection or a Share to offer, and stays live while the
 * layout is inert, as the connection chip did. A wheel or a pinch over them reaches the canvas
 * (`useWheelToCanvas`), so the bars never stop the camera. Their states: while the
 * live board loads (`isLoadingLiveBoard`) a progress line runs along the top edge and
 * the board-name bar's subtitle says so; while a synced board is away from the relay
 * (`isAwayFromRelay`) the offline banner (`OfflineBanner`) shows, with Retry now, in
 * the toast region over the dock (item 4). Below 768 px wide the two
 * bars are one compact top bar, 374 px: the way home, the name over the connection's state and
 * who is here (`compactStatusOf`), the board menu, the people, Share and the account button; the
 * offline banner is then its compact form under the bar (MX2).
 *
 * @param props - The board-name bar's content and menu, whether the layout is inert, the
 *   connection and the share handler.
 * @returns The bars.
 */
export function ShellTopBars(props: ShellTopBarsProps): ReactElement {
  const {
    isInert,
    connection,
    onShare,
    onCopyLink,
    pageNameOf,
    account,
    board,
    search,
    exporter,
    pageList,
    helpLinks,
    ...boardBar
  } = props;
  const hasPresenceBar = connection !== undefined || onShare !== undefined || account !== undefined;
  const barsRef = useRef<HTMLDivElement>(null);
  useWheelToCanvas(barsRef, canvasBeside);
  const status = useConnectionStatus(connection);
  const isLoadingLive = status !== undefined && isLoadingLiveBoard(status);
  const isAway = status !== undefined && isAwayFromRelay(status);
  const isCompact = useIsMobileSite();
  const chrome = useWhiteboardChrome();
  return (
    <>
      {isLoadingLive ? <LiveBoardProgress /> : null}
      <div ref={barsRef} className={styles.topBars} data-top-bars="">
        <div className={styles.contents} inert={isInert}>
          {chrome === 'floating' ? (
            <FloatingBoardBar
              {...boardBar}
              board={board}
              search={search}
              exporter={exporter}
              pageList={pageList}
              helpLinks={helpLinks}
            />
          ) : (
            <BoardNameBar
              {...boardBar}
              isLoadingLiveBoard={isLoadingLive}
              compactStatus={
                isCompact && status !== undefined
                  ? compactStatusOf(status, account?.principalId)
                  : undefined
              }
            />
          )}
        </div>
        {hasPresenceBar ? (
          <PresenceShareBar
            connection={connection}
            onShare={onShare}
            onCopyLink={onCopyLink}
            isShareInert={isInert}
            account={account}
            isFloating={chrome === 'floating' && !isCompact}
            {...(pageNameOf === undefined ? {} : { pageNameOf })}
          />
        ) : null}
        {connection === undefined ? null : (
          <OfflineBanner
            isShown={isAway}
            isDeviceOffline={status?.state === 'offline'}
            onRetry={retryOf(connection)}
            isCompact={isCompact}
          />
        )}
      </div>
    </>
  );
}
