import { decodeBoardToken, type BoardTokenClaims } from './board-token.js';
import type { TokenSource } from './token-source.js';

/**
 * What a token request ends in: a token to connect with; `refused`, when the fresh token is
 * the one the relay just refused (retrying cannot succeed); `invalid`, when it is not a token
 * for this board (reason `malformed` or `wrong-board`, as the relay names them); or `failed`,
 * when the provider rejected.
 */
export type TokenOutcome =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string; readonly error: RangeError }
  | { readonly kind: 'failed'; readonly error: unknown };

/**
 * The close reason of a refresh the relay refused (the relay's
 * `TOKEN_REFRESH_REFUSED_REASON`): the refusal is recorded against the token that was sent.
 */
export const TOKEN_REFRESH_REFUSED_REASON = 'token-refresh-refused';

/**
 * What a refresh request ends in: a newer token to send; `stale`, when the provider
 * handed back the connection's token or one expiring no later (nothing to send); `invalid`, a
 * token that is not one or opens another board; or `failed`, when the provider rejected.
 */
export type RefreshOutcome =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'stale' }
  | { readonly kind: 'invalid'; readonly error: RangeError }
  | { readonly kind: 'failed'; readonly error: unknown };

/** The request a refresh makes of the provider. */
const REFRESH_REQUEST = Object.freeze({ isAfterRefusal: false, isRefresh: true });

/**
 * The board tokens of one collab client's connections: the first
 * token (already fetched with the client), then a fresh one from the source for every later
 * attempt. After the relay refuses a token, one retry with a fresh token is allowed; a fresh
 * token equal to the refused one ends it at once. The allowance comes back once a token is
 * accepted. A request whose attempt was cancelled (the connection closed, the client went
 * offline or was destroyed) never delivers. Main thread or worker.
 */
export class ConnectionTokens {
  readonly #source: TokenSource;
  readonly #boardId: string;
  #first: string | undefined;
  #current: string | undefined;
  #refusal: { readonly token: string | undefined; readonly reason: string } | undefined;
  #refreshSent: string | undefined;
  #generation = 0;

  /**
   * Starts from the first token.
   *
   * @param source - Where later tokens come from.
   * @param firstToken - The token the client was created with; the first attempt uses it.
   * @param boardId - The client's board, which every token must open.
   */
  constructor(source: TokenSource, firstToken: string, boardId: string) {
    this.#source = source;
    this.#first = firstToken;
    this.#boardId = boardId;
  }

  /**
   * Gets the token for a new attempt and delivers the outcome: in the same task for the first
   * token and a fixed one, else once the provider answers, unless {@link cancel} ran first. The
   * provider is told whether the request follows a refusal (`isAfterRefusal`), whatever the
   * connection's state was when the relay refused.
   *
   * @param deliver - Receives the outcome.
   */
  request(deliver: (outcome: TokenOutcome) => void): void {
    this.#generation += 1;
    const generation = this.#generation;
    this.#refreshSent = undefined;
    // A refusal not yet followed by an accepted token: the provider must not reuse what it holds.
    const next = this.#first ?? this.#source.next({ isAfterRefusal: this.#refusal !== undefined });
    this.#first = undefined;
    if (typeof next === 'string') {
      deliver(this.#check(next));
      return;
    }
    next.then(
      (token) => {
        if (generation === this.#generation) deliver(this.#check(token));
      },
      (error: unknown) => {
        if (generation === this.#generation) deliver({ kind: 'failed', error });
      },
    );
  }

  /**
   * Asks the provider for a token to replace the open connection's before it expires,
   * with `{ isRefresh: true }`, and delivers the outcome unless {@link cancel} or a new
   * {@link request} ran first. Only a token for this board that differs from the current one and
   * expires later is worth sending.
   *
   * @param deliver - Receives the outcome.
   */
  refresh(deliver: (outcome: RefreshOutcome) => void): void {
    this.#generation += 1;
    const generation = this.#generation;
    Promise.resolve()
      .then(() => this.#source.next(REFRESH_REQUEST))
      .then(
        (token) => {
          if (generation === this.#generation) deliver(this.#checkRefresh(token));
        },
        (error: unknown) => {
          if (generation === this.#generation) deliver({ kind: 'failed', error });
        },
      );
  }

  /**
   * Records the refresh token sent, so a `token-refresh-refused` close is held against it.
   *
   * @param token - The token sent.
   */
  refreshSent(token: string): void {
    this.#refreshSent = token;
  }

  /**
   * The relay accepted a refresh: its token is the connection's from now on.
   *
   * @param token - The token.
   */
  refreshed(token: string): void {
    this.#current = token;
    this.#refreshSent = undefined;
    this.accepted();
  }

  /** Drops the pending request, if any: its outcome is never delivered. */
  cancel(): void {
    this.#generation += 1;
  }

  /**
   * Records that the relay refused the current token and tells whether to retry once with a
   * fresh one: yes for the first refusal since a token was accepted, no after that.
   *
   * @param reason - The relay's reason.
   * @returns Whether to retry.
   */
  retryAfterRefusal(reason: string): boolean {
    if (this.#refusal !== undefined) return false;
    const isRefreshRefused =
      reason === TOKEN_REFRESH_REFUSED_REASON && this.#refreshSent !== undefined;
    this.#refusal = { token: isRefreshRefused ? this.#refreshSent : this.#current, reason };
    return true;
  }

  /** The relay accepted the current token: a later refusal may be retried again. */
  accepted(): void {
    this.#refusal = undefined;
  }

  /**
   * Checks a refresh token: this board, not the current token, and a later `exp`.
   *
   * @param token - The token.
   * @returns The outcome.
   */
  #checkRefresh(token: string): RefreshOutcome {
    let claims: BoardTokenClaims;
    try {
      claims = decodeBoardToken(token);
    } catch (error: unknown) {
      return { kind: 'invalid', error: error as RangeError };
    }
    if (claims.boardId !== this.#boardId) {
      const error = new RangeError(
        `The refreshed token opens board ${JSON.stringify(claims.boardId)}, not ` +
          `${JSON.stringify(this.#boardId)}.`,
      );
      return { kind: 'invalid', error };
    }
    const current = this.#current === undefined ? undefined : decodeBoardToken(this.#current);
    const isLater = (claims.expiresAt ?? 0) > (current?.expiresAt ?? 0);
    return token === this.#current || !isLater ? { kind: 'stale' } : { kind: 'token', token };
  }

  /**
   * Checks a token for an attempt and makes it the current one.
   *
   * @param token - The token.
   * @returns The outcome.
   */
  #check(token: string): TokenOutcome {
    if (this.#refusal !== undefined && this.#refusal.token === token) {
      return { kind: 'refused', reason: this.#refusal.reason };
    }
    let boardId: string;
    try {
      boardId = decodeBoardToken(token).boardId;
    } catch (error: unknown) {
      return { kind: 'invalid', reason: 'malformed', error: error as RangeError };
    }
    if (boardId !== this.#boardId) {
      const error = new RangeError(
        `The refreshed token opens board ${JSON.stringify(boardId)}, not ` +
          `${JSON.stringify(this.#boardId)}.`,
      );
      return { kind: 'invalid', reason: 'wrong-board', error };
    }
    this.#current = token;
    return { kind: 'token', token };
  }
}
