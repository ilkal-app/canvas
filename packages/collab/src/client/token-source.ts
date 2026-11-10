import { decodeBoardToken, type BoardTokenClaims } from './board-token.js';

/** What a collab client tells its token provider about one request for a token. */
export interface BoardTokenRequest {
  /**
   * True when the relay refused the last token (a permission-denied answer, or a 4401 or 4403
   * close such as `access-changed`, in any connection state, `connecting` included) and no token
   * has been accepted since: a provider that keeps tokens must not hand back one it held from
   * before, and asks its backend afresh.
   */
  readonly isAfterRefusal: boolean;
  /**
   * True when the token will replace an open connection's token before it expires:
   * a provider that keeps tokens must not hand back one it already handed out, and asks its
   * backend for a new one. Absent on every other request. A provider that ignores it may return
   * the token it holds; the client then sends nothing and reconnects at expiry, as before.
   */
  readonly isRefresh?: boolean;
}

/**
 * Fetches a board token for the next connection: the application
 * backend's current token for the board, refreshed when the old one expired. A collab client
 * calls it on every reconnection and, once, after the relay refused a token, always with a
 * {@link BoardTokenRequest} saying whether the call follows a refusal. Rejecting counts as a
 * failed connection attempt, retried with backoff.
 */
export type BoardTokenProvider = (request?: BoardTokenRequest) => Promise<string>;

/** A request that follows no refusal: the first one, and every one after a token was accepted. */
const ORDINARY_REQUEST: BoardTokenRequest = Object.freeze({ isAfterRefusal: false });

/** Where a client's board tokens come from: exactly one of a fixed token and a provider. */
export interface BoardTokenOptions {
  /**
   * A fixed board token; kept for compatibility. It cannot be refreshed, so once it expires the
   * client ends `unauthorized`: prefer `getToken`.
   */
  readonly token?: string;
  /** Fetches a fresh board token for each connection; see {@link BoardTokenProvider}. */
  readonly getToken?: BoardTokenProvider;
}

/** The tokens of one client: a fixed one, or one fetched from the provider per connection. */
export interface TokenSource {
  /**
   * The token for the next connection: the fixed one at once, or a promise of the provider's.
   *
   * @param request - Whether the request follows a refusal; passed to the provider (none says
   *   it does not).
   * @returns The token, or a promise of it that rejects when the provider fails.
   */
  next(request?: BoardTokenRequest): string | Promise<string>;
}

/**
 * Checks that the options name exactly one source of tokens.
 *
 * @param options - The token options.
 * @returns The fixed token, or the provider.
 * @throws {RangeError} When neither or both are given.
 */
function pickSource(options: BoardTokenOptions): string | BoardTokenProvider {
  const { token, getToken } = options;
  if (token !== undefined && getToken === undefined) return token;
  if (getToken !== undefined && token === undefined) return getToken;
  throw new RangeError('A collab client takes exactly one of `token` and `getToken`.');
}

/**
 * The token source of a client's options: a fixed `token` is handed out synchronously (so a
 * connection with it opens in the same task, as before tokens could be refreshed); a `getToken`
 * provider is asked for each token, with the {@link BoardTokenRequest} (not after a refusal
 * when none is given), and one that throws instead of rejecting still rejects.
 *
 * @param options - The client's `token` or `getToken`.
 * @returns The source.
 * @throws {RangeError} When the options give neither or both.
 */
export function createTokenSource(options: BoardTokenOptions): TokenSource {
  const source = pickSource(options);
  if (typeof source === 'string') return { next: () => source };
  return {
    next: (request = ORDINARY_REQUEST) =>
      new Promise<string>((resolve) => {
        resolve(source(request));
      }),
  };
}

/**
 * The provider behind a client's options, a fixed token wrapped as one that always returns it:
 * for callers that fetch the first token themselves (a headless client derives its principal
 * from it).
 *
 * @param options - The client's `token` or `getToken`.
 * @returns The provider.
 * @throws {RangeError} When the options give neither or both.
 */
export function resolveTokenProvider(options: BoardTokenOptions): BoardTokenProvider {
  const source = pickSource(options);
  return typeof source === 'string' ? () => Promise.resolve(source) : source;
}

/**
 * Reads a token's claims and checks that it opens the client's board.
 *
 * @param token - The board token.
 * @param boardId - The client's board.
 * @returns The claims.
 * @throws {RangeError} When the token is not a board token, or opens another board.
 */
export function readBoardTokenFor(token: string, boardId: string): BoardTokenClaims {
  const claims = decodeBoardToken(token);
  if (claims.boardId !== boardId) {
    throw new RangeError(
      `The token opens board ${JSON.stringify(claims.boardId)}, not ${JSON.stringify(boardId)}.`,
    );
  }
  return claims;
}
