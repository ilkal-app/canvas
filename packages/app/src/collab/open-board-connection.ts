import {
  createBrowserNetworkStatus,
  createCollabClient,
  decodeBoardToken,
  ReactionChannel,
  ServerClock,
  yieldToBrowser,
  type CollabClientOptions,
  type CollabSocketFactory,
  type DocumentCache,
  type NetworkStatus,
} from '@canvas/collab';
import { YjsDocumentStore } from '@canvas/document';

import type { PageImages } from '../assets/page-images.js';
import { configureFontCatalogue } from '../text-input/remote-font-catalogue.js';

import type { BoardAddress } from './board-address.js';
import { openBoardCacheOrNone } from './board-cache.js';
import type { BoardConnection, BoardSyncClient } from './board-connection.js';
import { pageImagesFor, providedPageImages, withBoardImages } from './board-images.js';
import { seedIfNeverWritten } from './board-seed.js';
import { createBoardTokenProvider, TokenEndpointUnreachableError } from './board-token-provider.js';
import { waitForFirstOutcome } from './first-outcome.js';
import { createLocalBoardConnection } from './local-board-connection.js';
import type { ProvidedBoardTokens } from './provided-board-tokens.js';
import { isReadOnlyRole } from './read-only-role.js';
import { SyncedBoardConnection } from './synced-board-connection.js';
import { userOriginFromClaims } from './user-origin.js';

/**
 * How long the page waits for the relay's first answer before it falls back to a local board,
 * in ms. A refused or unreachable relay answers well before; this bounds a silent one.
 */
export const DEFAULT_FIRST_OUTCOME_TIMEOUT_MS = 5_000;

/** What `openBoardConnection` needs; tests inject the client, cache and network. */
export interface OpenBoardConnectionOptions {
  /** The board, the relay and the token or token endpoint. */
  readonly address: BoardAddress;
  /**
   * Who fetched tokens are asked for (their `sub`): the tab's guest until sign-in exists. Called
   * only when the page fetches tokens (a relay and no `?token=`), so a local page draws no
   * random numbers for it.
   */
  readonly guestSubject: () => string;
  /** Creates the collab client; `createCollabClient` by default. */
  readonly createClient?: (options: CollabClientOptions) => Promise<BoardSyncClient>;
  /**
   * Opens the device's board cache, which the relay path and the local board share; the
   * IndexedDB cache (`canvas-board-cache:layout:<n>` for this build's `DOCUMENT_LAYOUT_VERSION`,
   * keyed by board id) by default, none where there is no IndexedDB.
   */
  readonly openCache?: () => Promise<DocumentCache | undefined>;
  /** Renderer preparation after connected carry-over, without reported startup errors. */
  readonly prepareSnapshotPreview?: () => Promise<Uint8Array | undefined>;
  /** Optional authorized preview attempt, before constructing or hydrating the document. */
  readonly beforeHydration?: (
    cache: DocumentCache | undefined,
    images: PageImages,
  ) => Promise<void>;
  /** The device's network signal; `navigator.onLine` by default. */
  readonly network?: NetworkStatus;
  /**
   * Opens the relay's sockets; the platform `WebSocket` by default. The site wraps it to follow
   * the connection's steps for its loading bar.
   */
  readonly socketFactory?: CollabSocketFactory;
  /** The fetch the token provider uses; the window's by default. */
  readonly fetch?: typeof fetch;
  /** How long to wait for the relay's first answer, in ms; `DEFAULT_FIRST_OUTCOME_TIMEOUT_MS` (5 000). */
  readonly firstOutcomeTimeoutMs?: number;
  /** Receives failures that do not stop the shell; the page's `reportError` by default. */
  readonly onError?: (error: unknown) => void;
  /**
   * The board's tokens and the person's name from the page's own source (the site); when
   * given, the address's token and token endpoint are not used and no guest is drawn.
   */
  readonly tokens?: ProvidedBoardTokens;
  /**
   * Whether a board never written is seeded with the demo board (the playground's); `true` by
   * default. The site's boards start empty.
   */
  readonly shouldSeedDemoBoard?: boolean;
  /**
   * Whether the page already knows the person may only view the board (the site, from the
   * boards service's role), for a local board opened before any token's role is known; a
   * token's role decides once a client starts. False if absent.
   */
  readonly isReadOnly?: boolean;
}

/**
 * Reports a failure to the page as an uncaught error would be.
 *
 * @param error - The failure.
 */
function reportToPage(error: unknown): void {
  reportError(error);
}

/**
 * Wraps the page's error reporting so that a token endpoint that does not answer is not
 * reported: it is the same condition as a relay that does not answer (no `pnpm dev:relay`), which
 * the chip shows, and a page reporting it would log an uncaught error on every load and every
 * retry. Every other failure is reported.
 *
 * @param report - The page's error reporting.
 * @returns The wrapped reporting.
 */
function reportUnlessUnreachable(report: (error: unknown) => void): (error: unknown) => void {
  return (error) => {
    if (!(error instanceof TokenEndpointUnreachableError)) report(error);
  };
}

/**
 * The display name presence shows for this tab: the given token's subject, else the guest's.
 *
 * @param address - The address, which may carry a token.
 * @param subject - The guest subject.
 * @returns The name.
 */
function presenceName(address: BoardAddress, subject: () => string): string {
  if (address.token === undefined) return subject();
  try {
    return decodeBoardToken(address.token).principalId;
  } catch {
    return subject();
  }
}

/**
 * Creates the collab client over a new store.
 *
 * @param store - The store to sync.
 * @param cache - The offline cache, if one opened.
 * @param options - The connection's options.
 * @param url - The relay.
 * @param report - Receives the client's failures that do not stop it.
 * @param channels - The estimate of the relay's clock the client keeps, and the board's
 *   reactions.
 * @param channels.serverClock - The clock.
 * @param channels.reactions - The reactions.
 * @returns The client.
 */
async function createClientFor(
  store: YjsDocumentStore,
  cache: DocumentCache | undefined,
  options: OpenBoardConnectionOptions,
  url: string,
  report: (error: unknown) => void,
  channels: { readonly serverClock: ServerClock; readonly reactions: ReactionChannel },
): Promise<BoardSyncClient> {
  const { serverClock, reactions } = channels;
  const { address, tokens } = options;
  let subject: string | undefined;
  const guestSubject = (): string => (subject ??= options.guestSubject());
  const state: { client?: BoardSyncClient } = {};
  let hasError = false;
  const isEligible = (): boolean => !hasError && state.client?.status.state === 'connected';
  const prepare = async (): Promise<Uint8Array | undefined> => {
    const client = state.client;
    if (client === undefined || !isEligible()) return undefined;
    const carryOver = client.layoutCarryOver;
    if (carryOver !== undefined) {
      if (carryOver.run === undefined) return undefined;
      await carryOver.run(!client.status.isReadOnly);
      if (carryOver.stranded.length > 0) return undefined;
    }
    if (!isEligible()) return undefined;
    const bytes = await options.prepareSnapshotPreview?.();
    return isEligible() ? bytes : undefined;
  };
  const client = await (options.createClient ?? createCollabClient)({
    store,
    boardId: address.boardId,
    url,
    getToken:
      tokens?.getToken ??
      createBoardTokenProvider({
        address,
        subject: guestSubject,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
    ...(cache === undefined ? {} : { cache }),
    // A large cached board restores in browser tasks, so input is handled meanwhile.
    yieldToBrowser,
    network: options.network ?? createBrowserNetworkStatus(),
    serverClock,
    reactions,
    presence: { name: tokens?.presenceName ?? presenceName(address, guestSubject) },
    onError: (error) => {
      hasError = true;
      report(error);
    },
    ...(options.prepareSnapshotPreview === undefined ? {} : { prepareSnapshotPreview: prepare }),
    ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
  });
  state.client = client;
  return client;
}

/**
 * Opens the shell's board: with a relay, a store synced by a collab
 * client (a token provider asked on every connection, the device's board cache, the network
 * signal, presence under the token's principal), which the shell's engine document then edits;
 * once the first sync finds the board never written (no objects and no metadata stamp: a board
 * someone cleared is stamped, and left empty), it is seeded with the demo board through the
 * command layer as the product (deterministic ids, so two tabs seeding at once write the same
 * objects). When no relay is configured, the client cannot start, or the relay's first answer is
 * a failure (unreachable, offline, or nothing within the timeout) and nothing was cached, the
 * page keeps working on the local board instead (`createLocalBoardConnection`: the same cache,
 * so its edits survive a reload and reach the relay when the board is next opened with one; it
 * holds the cache's compactions, so that open replays them transaction by transaction), and
 * says so; a refused token shows as `unauthorized`. A cached board stays synced mode: the client
 * keeps retrying while the cached copy is edited; so does a viewer's board, read-only,
 * filled in when the relay answers. A local board keeps the person's role (`isReadOnly`). A token endpoint that does not answer is not
 * reported (it means no relay, as an unreachable relay does). The connection carries the board's
 * images (`pageImagesFor`: the assets service and tokens). Main thread.
 *
 * @param options - The address, the guest subject, and injected client, cache and network.
 * @returns The connection, once its first outcome is known.
 */
export async function openBoardConnection(
  options: OpenBoardConnectionOptions,
): Promise<BoardConnection> {
  const { address, tokens } = options;
  configureFontCatalogue(address.assetsUrl);
  const images =
    tokens === undefined
      ? pageImagesFor(address, {
          subject: options.guestSubject,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        })
      : providedPageImages(address, tokens);
  try {
    const connection = await openConnection(options, images);
    return withBoardImages(connection, images);
  } catch (error) {
    images.destroy();
    throw error;
  }
}

/**
 * Opens the board's store: synced, or the local board (see {@link openBoardConnection}).
 *
 * @param options - The address, the guest subject, and injected client, cache and network.
 * @param images - The same adapter used by any early preview and the live board.
 * @returns The connection, once its first outcome is known.
 */
async function openConnection(
  options: OpenBoardConnectionOptions,
  images: PageImages,
): Promise<BoardConnection> {
  const { address } = options;
  const report = reportUnlessUnreachable(options.onError ?? reportToPage);
  const shouldSeedDemoBoard = options.shouldSeedDemoBoard ?? true;
  if (address.relayUrl === undefined) {
    return createLocalBoardConnection(address.boardId, {
      ...(options.openCache === undefined ? {} : { openCache: options.openCache }),
      onError: report,
      shouldSeedDemoBoard,
      isReadOnly: options.isReadOnly === true,
    });
  }
  const cache = await openBoardCacheOrNone(options.openCache, report);
  try {
    await options.beforeHydration?.(cache, images);
  } catch (error: unknown) {
    report(error);
  }
  const store = new YjsDocumentStore();
  const serverClock = new ServerClock();
  const reactions = new ReactionChannel();
  let client: BoardSyncClient | undefined;
  try {
    client = await createClientFor(store, cache, options, address.relayUrl, report, {
      serverClock,
      reactions,
    });
    const origin = userOriginFromClaims(client.claims);
    const outcome = await waitForFirstOutcome(
      client,
      options.firstOutcomeTimeoutMs ?? DEFAULT_FIRST_OUTCOME_TIMEOUT_MS,
    );
    if (outcome === 'connected' && shouldSeedDemoBoard) seedIfNeverWritten(store);
    const isEmpty = store.read().objects.size === 0;
    // A refused token shows as such, over whatever the device had cached; only a board no relay
    // answered for and nothing cached falls back to the local board. A viewer's never does: a
    // local board would be one they could edit and nobody would see, so their page stays synced,
    // read-only, and fills in when the relay answers.
    if (outcome !== 'failed' || !isEmpty || isReadOnlyRole(client.claims.role)) {
      return new SyncedBoardConnection(
        store,
        client,
        origin,
        {
          isSavedOnDevice: cache !== undefined,
          release: () => cache?.close(),
        },
        { serverClock, reactions },
      );
    }
  } catch (error: unknown) {
    report(error);
  }
  const isReadOnly =
    client === undefined ? options.isReadOnly === true : isReadOnlyRole(client.claims.role);
  client?.destroy();
  store.destroy();
  // The local board takes over the cache the relay path opened (or its absence, already
  // reported), under the same board id, and the person's role.
  return createLocalBoardConnection(address.boardId, {
    openCache: () => Promise.resolve(cache),
    onError: report,
    shouldSeedDemoBoard,
    isReadOnly,
    // A relay is configured: the edits reach it on the next synced open. A viewer's
    // local board makes none, so it holds nothing back (the collab client also releases its hold
    // on a read-only connection).
    shouldHoldCompaction: !isReadOnly,
  });
}
