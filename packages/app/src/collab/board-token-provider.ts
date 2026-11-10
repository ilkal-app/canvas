import type { BoardTokenProvider } from '@canvas/collab';

import type { BoardAddress } from './board-address.js';

/** What `createBoardTokenProvider` needs. */
export interface BoardTokenProviderOptions {
  /** The board, and the token the page was given or the endpoint to fetch tokens from. */
  readonly address: BoardAddress;
  /**
   * Who to ask a token for (the token's `sub`): the tab's guest until sign-in exists; called when
   * a token is fetched, never for a page given its token.
   */
  readonly subject: () => string;
  /** The fetch to use; the window's by default. */
  readonly fetch?: typeof fetch;
}

/**
 * The token endpoint did not answer at all (nothing listening, no network): the same condition
 * as a relay that does not answer, which the page treats as "no relay", not as a fault. It is
 * surfaced through the connection state (the chip's `Offline · local board`), never the console
 * or the page's error reporting, so a misconfigured token endpoint shows as offline.
 */
export class TokenEndpointUnreachableError extends Error {
  /**
   * Names the endpoint.
   *
   * @param tokenUrl - The endpoint that did not answer.
   * @param cause - The fetch's rejection.
   */
  constructor(tokenUrl: string, cause: unknown) {
    super(`The token endpoint ${tokenUrl} did not answer.`, { cause });
    this.name = 'TokenEndpointUnreachableError';
  }
}

/**
 * Fetches from the token endpoint, telling an endpoint that did not answer from one that did.
 *
 * @param fetchToken - The fetch.
 * @param url - The request's URL.
 * @param tokenUrl - The endpoint, for the error.
 * @returns The response.
 * @throws {TokenEndpointUnreachableError} When the fetch rejects.
 */
async function fetchFrom(fetchToken: typeof fetch, url: URL, tokenUrl: string): Promise<Response> {
  try {
    return await fetchToken(url, { cache: 'no-store' });
  } catch (error: unknown) {
    throw new TokenEndpointUnreachableError(tokenUrl, error);
  }
}

/**
 * Reads the token out of the endpoint's answer, `{ "token": "…" }`.
 *
 * @param response - The endpoint's response.
 * @returns The token.
 * @throws {Error} When the endpoint refused or answered without a token.
 */
async function readToken(response: Response): Promise<string> {
  if (!response.ok) {
    throw new Error(`The token endpoint answered ${String(response.status)}.`);
  }
  const body: unknown = await response.json();
  const token: unknown =
    typeof body === 'object' && body !== null && 'token' in body ? body.token : undefined;
  if (typeof token !== 'string' || token === '') {
    throw new Error('The token endpoint answered with no token.');
  }
  return token;
}

/**
 * The collab client's token provider for a page: the token given with
 * the page (`?token=`, as scenario tests pass minted tokens), or a fresh one fetched from the
 * token endpoint for the board and subject on every call, so a reconnection after the token
 * expired gets a new one; an endpoint that does not answer rejects with a
 * {@link TokenEndpointUnreachableError}. The endpoint is the stand-in for the application backend that
 * `pnpm dev:relay` serves until sign-in exists. Main thread.
 *
 * @param options - The address, the subject and the fetch.
 * @returns The provider.
 * @throws {RangeError} When the address has neither a token nor a token endpoint.
 */
export function createBoardTokenProvider(options: BoardTokenProviderOptions): BoardTokenProvider {
  const { address, subject } = options;
  const { token, tokenUrl } = address;
  if (token !== undefined) return () => Promise.resolve(token);
  if (tokenUrl === undefined) {
    throw new RangeError(`Board ${address.boardId} has no token and no token endpoint.`);
  }
  const fetchToken = options.fetch ?? ((input, init) => fetch(input, init));
  return async () => {
    const url = new URL(tokenUrl);
    url.searchParams.set('board', address.boardId);
    url.searchParams.set('sub', subject());
    return readToken(await fetchFrom(fetchToken, url, tokenUrl));
  };
}
