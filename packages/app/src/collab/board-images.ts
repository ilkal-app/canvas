import { PageImages, type BoardImageAccess } from '../assets/page-images.js';

import type { BoardAddress } from './board-address.js';
import type { BoardConnection } from './board-connection.js';
import { createBoardTokenProvider } from './board-token-provider.js';
import type { ProvidedBoardTokens } from './provided-board-tokens.js';

/** What {@link boardImageAccessOf} fetches tokens with. */
export interface BoardImageAccessOptions {
  /** Who fetched tokens are asked for (the tab's guest), read only when one is fetched. */
  readonly subject: () => string;
  /** The fetch; the window's by default. */
  readonly fetch?: typeof fetch;
}

/**
 * A board's images access from its address: its assets service, the reader's token for
 * the board (the page's `?token=`, or a fresh one from the token endpoint), and a token for
 * another board from the same endpoint, for a paste from it. None without an assets service or
 * any way to a token. Main thread.
 *
 * @param address - The board's address.
 * @param options - The guest subject and the fetch.
 * @returns The access, or undefined.
 */
export function boardImageAccessOf(
  address: BoardAddress,
  options: BoardImageAccessOptions,
): BoardImageAccess | undefined {
  const { assetsUrl, boardId, token, tokenUrl } = address;
  if (assetsUrl === undefined || (token === undefined && tokenUrl === undefined)) return undefined;
  const providerFor = (board: string, given: string | undefined) =>
    createBoardTokenProvider({
      address: { ...address, boardId: board, token: given },
      subject: options.subject,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const own = providerFor(boardId, token);
  return {
    assetsUrl,
    boardId,
    token: () => own(),
    tokenFor: (board) =>
      tokenUrl === undefined ? Promise.resolve(undefined) : providerFor(board, undefined)(),
  };
}

/**
 * A connection that also carries the board's images, destroyed with it.
 *
 * @param connection - The connection.
 * @param images - The board's images.
 * @returns The connection with `images`.
 */
export function withBoardImages(connection: BoardConnection, images: PageImages): BoardConnection {
  return {
    get recovery() {
      return connection.recovery;
    },
    get cacheWrites() {
      return connection.cacheWrites;
    },
    store: connection.store,
    origin: connection.origin,
    ...(connection.serverClock === undefined ? {} : { serverClock: connection.serverClock }),
    ...(connection.reactions === undefined ? {} : { reactions: connection.reactions }),
    images,
    status: () => connection.status(),
    subscribe: (listener) => connection.subscribe(listener),
    onThreadsChanged: (listener) => connection.onThreadsChanged?.(listener) ?? (() => undefined),
    onVotesChanged: (listener) => connection.onVotesChanged?.(listener) ?? (() => undefined),
    dismissStrandedEdits: (source) => {
      connection.dismissStrandedEdits(source);
    },
    // Only where the connection can reconnect: without it the offline banner offers no Retry now.
    ...(connection.retryNow === undefined
      ? {}
      : {
          retryNow: () => {
            connection.retryNow?.();
          },
        }),
    showPage: (pageId) => {
      connection.showPage?.(pageId);
    },
    showEditing: (editing) => {
      connection.showEditing?.(editing);
    },
    showViewport: (viewport) => {
      connection.showViewport?.(viewport);
    },
    showCursor: (cursor) => {
      connection.showCursor?.(cursor);
    },
    showSelection: (ids) => {
      connection.showSelection?.(ids);
    },
    // Only where there is presence: the undo notice then names whom the relay vouches for.
    ...(connection.remotePresence === undefined
      ? {}
      : { remotePresence: connection.remotePresence.bind(connection) }),
    // Its undo history sees each presence change, not only each refresh.
    ...(connection.subscribePresenceChanges === undefined
      ? {}
      : { subscribePresenceChanges: connection.subscribePresenceChanges.bind(connection) }),
    // Following and the spotlight need the local presence; only where there is one.
    ...(connection.localPresence === undefined
      ? {}
      : { localPresence: connection.localPresence.bind(connection) }),
    showSpotlight: (spotlight) => {
      connection.showSpotlight?.(spotlight);
    },
    showFollowing: (principalId) => {
      connection.showFollowing?.(principalId);
    },
    ...(connection.stopSyncing === undefined
      ? {}
      : {
          stopSyncing: () => {
            connection.stopSyncing?.();
          },
        }),
    destroy: () => {
      images.destroy();
      connection.destroy();
    },
  };
}

/**
 * The page's images for a board's address: its access, or none, and the board a copy names.
 *
 * @param address - The board's address.
 * @param options - The guest subject and the fetch.
 * @returns The images.
 */
export function pageImagesFor(address: BoardAddress, options: BoardImageAccessOptions): PageImages {
  return new PageImages(boardImageAccessOf(address, options), { boardId: address.boardId });
}

/**
 * A board's images access with tokens from the page's own source (the site's boards service,
 * `ProvidedBoardTokens`): its assets service, the board's token (a fresh one once the assets
 * service refused the one held) and another board's, for a paste from it. None without an
 * assets service. Main thread.
 *
 * @param address - The board's address.
 * @param tokens - The tokens.
 * @returns The access, or undefined.
 */
export function providedImageAccess(
  address: BoardAddress,
  tokens: Omit<ProvidedBoardTokens, 'presenceName'>,
): BoardImageAccess | undefined {
  const { assetsUrl, boardId } = address;
  if (assetsUrl === undefined) return undefined;
  return {
    assetsUrl,
    boardId,
    token: (isFresh) => (isFresh ? tokens.freshToken() : tokens.getToken()),
    tokenFor: (board) => tokens.tokenFor(board),
  };
}

/**
 * The page's images for a board whose tokens the page provides ({@link providedImageAccess}).
 *
 * @param address - The board's address.
 * @param tokens - The tokens.
 * @returns The images.
 */
export function providedPageImages(
  address: BoardAddress,
  tokens: Omit<ProvidedBoardTokens, 'presenceName'>,
): PageImages {
  return new PageImages(providedImageAccess(address, tokens), { boardId: address.boardId });
}
