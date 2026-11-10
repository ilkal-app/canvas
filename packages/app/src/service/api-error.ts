import { BOARD_MODES, type BoardMode } from '@canvas/schema';

/**
 * The error codes of the contract the site acts on. Anything else the service answers (another
 * code, a `5xx`, a body that is not the contract's) is `unavailable`.
 */
export const API_REFUSAL_CODES = [
  'signed-out',
  'session-revoked',
  'not-found',
  'forbidden-origin',
  'environment-private',
  'sign-in-unavailable',
  'invalid-request',
  'board-limit',
  'board-full',
  'invitation-limit',
  'already-member',
  'email-limit',
  'rate-limited',
  'owner-cannot-leave',
  'wrong-address',
  // Dot voting: a commenter or viewer, a vote already open, one closed, an allowance used.
  'vote-forbidden',
  'vote-open',
  'vote-closed',
  'vote-limit',
  // Deleting an account: sign in again first, the typed address is not theirs, a board
  // cannot go to the member named, or a subscription could still bill. Nothing was deleted.
  'reauthentication-required',
  'confirmation-mismatch',
  'hand-over-refused',
  'subscription-active',
  // Checkout for someone who already pays: the billing portal changes it.
  'already-subscribed',
  // The no-card trial: had one already, or not on Free.
  'trial-used',
  'not-on-free',
  // A board mode, or another feature, that is off for the person: names no flag.
  'feature-disabled',
  // A board made from a template that the relay did not seed: it was never opened.
  'relay-unavailable',
  // Signing in with an email code: a wrong code (with the tries left), an expired one,
  // one with no tries left (or none sent), a new person the signup gate holds back, and an
  // address the identity provider has not verified.
  'code-invalid',
  'code-expired',
  'code-spent',
  'waitlist',
  'email-unverified',
  // A Google sign-in held back for the code WorkOS emailed: none, or it expired; and an
  // account that needs a sign-in step the service does not offer.
  'verification-not-found',
  'sign-in-step-unsupported',
  // Joining as a guest: a name that is empty, too long or has control characters.
  'invalid-name',
  // The admin page's demo board: a board that is not a whiteboard.
  'not-a-whiteboard',
] as const;

/** A refusal of the contract, by its code. */
export type ApiRefusalCode = (typeof API_REFUSAL_CODES)[number];

/** Every error the client gives: a refusal of the contract, or `unavailable` for the rest. */
export type ApiErrorCode = ApiRefusalCode | 'unavailable';

/** The board a `feature-disabled` refusal of opening it names: its title and mode. */
export interface UnavailableBoard {
  /** Its title. */
  readonly title: string;
  /** Its mode, which the person's flags leave off. */
  readonly mode: BoardMode;
}

/** What an {@link ApiError} carries besides its code. */
export interface ApiErrorDetails {
  /** The HTTP status, when the service answered. */
  readonly status?: number;
  /** A `wrong-address` refusal's masked address (`j***@example.com`). */
  readonly invitedEmailHint?: string;
  /** A `429` refusal's (`email-limit`, `rate-limited`) `Retry-After`, in seconds. */
  readonly retryAfterSeconds?: number;
  /**
   * A refusal at a limit's (`board-limit`, `invitation-limit`, `email-limit`) limit, the one the
   * service applied: the person's or the board owner's plan's.
   */
  readonly limit?: number;
  /** A `feature-disabled` refusal's board, when the service named it. */
  readonly board?: UnavailableBoard;
  /** A `code-invalid` refusal's tries left. */
  readonly triesLeft?: number;
  /** What failed underneath (a network error), for debugging; never shown. */
  readonly cause?: unknown;
}

/**
 * A request to the boards service that did not succeed, by the contract's code. Its message is
 * the site's own and never the service's: the pages choose their words from the code, so no
 * text from the server reaches the person.
 */
export class ApiError extends Error {
  /** The code. */
  readonly code: ApiErrorCode;
  /** The HTTP status, when the service answered. */
  readonly status: number | undefined;
  /** A `wrong-address` refusal's masked address. */
  readonly invitedEmailHint: string | undefined;
  /** A `429` refusal's (`email-limit`, `rate-limited`) wait, in seconds. */
  readonly retryAfterSeconds: number | undefined;
  /** A refusal at a limit's limit, when the service named it. */
  readonly limit: number | undefined;
  /** A `feature-disabled` refusal's board, when the service named it. */
  readonly board: UnavailableBoard | undefined;
  /** A `code-invalid` refusal's tries left, when the service said. */
  readonly triesLeft: number | undefined;

  /**
   * Makes the error.
   *
   * @param code - The code.
   * @param details - The status, the hint, the wait and the cause.
   */
  constructor(code: ApiErrorCode, details: ApiErrorDetails = {}) {
    super(`The boards service request failed: ${code}.`, { cause: details.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = details.status;
    this.invitedEmailHint = details.invitedEmailHint;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.limit = details.limit;
    this.board = details.board;
    this.triesLeft = details.triesLeft;
  }
}

/**
 * Whether an error is an {@link ApiError}, of one of the given codes when any are given.
 *
 * @param error - The error.
 * @param codes - The codes it may have; any if none.
 * @returns Whether it is.
 */
export function isApiError(error: unknown, ...codes: readonly ApiErrorCode[]): error is ApiError {
  return error instanceof ApiError && (codes.length === 0 || codes.includes(error.code));
}

/**
 * Whether a string is a refusal code of the contract.
 *
 * @param code - The string.
 * @returns Whether it is.
 */
function isRefusalCode(code: unknown): code is ApiRefusalCode {
  return (API_REFUSAL_CODES as readonly unknown[]).includes(code);
}

/**
 * A field of an error body, if the body is an object.
 *
 * @param body - The body.
 * @param name - The field.
 * @returns Its value.
 */
function fieldOf(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The board a `feature-disabled` refusal names: its title and a known mode, or nothing.
 *
 * @param value - The refusal's `board`.
 * @returns The board, or undefined.
 */
function unavailableBoardOf(value: unknown): UnavailableBoard | undefined {
  const title = fieldOf(value, 'title');
  const mode = fieldOf(value, 'mode');
  return typeof title === 'string' && (BOARD_MODES as readonly unknown[]).includes(mode)
    ? { title, mode: mode as BoardMode }
    : undefined;
}

/**
 * A `Retry-After` in seconds, when it is a whole number of them.
 *
 * @param header - The header's value.
 * @returns The seconds, or undefined.
 */
function retryAfterOf(header: string | null): number | undefined {
  return header !== null && /^\d{1,9}$/.test(header) ? Number(header) : undefined;
}

/**
 * The error for a service's refusal (`{ "error": "<code>", "message": "…" }`): the contract's
 * code, with the `wrong-address` hint, a limit's `limit`, a wrong email code's `triesLeft`
 * and the `Retry-After`; `unavailable` for a code outside
 * the contract or a body that is not the contract's. The message is never kept. Pure.
 *
 * @param status - The HTTP status.
 * @param body - The parsed body, if it parsed.
 * @param retryAfter - The `Retry-After` header, if any.
 * @returns The error.
 */
export function apiErrorFromAnswer(
  status: number,
  body: unknown,
  retryAfter: string | null,
): ApiError {
  const code = fieldOf(body, 'error');
  if (!isRefusalCode(code)) return new ApiError('unavailable', { status });
  const hint = fieldOf(body, 'invitedEmailHint');
  const limit = fieldOf(body, 'limit');
  const triesLeft = fieldOf(body, 'triesLeft');
  const retryAfterSeconds = retryAfterOf(retryAfter);
  const board =
    code === 'feature-disabled' ? unavailableBoardOf(fieldOf(body, 'board')) : undefined;
  return new ApiError(code, {
    status,
    ...(board === undefined ? {} : { board }),
    ...(code === 'wrong-address' && typeof hint === 'string' ? { invitedEmailHint: hint } : {}),
    ...(Number.isSafeInteger(limit) && (limit as number) >= 0 ? { limit: limit as number } : {}),
    ...(code === 'code-invalid' && Number.isSafeInteger(triesLeft) && (triesLeft as number) >= 0
      ? { triesLeft: triesLeft as number }
      : {}),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}
