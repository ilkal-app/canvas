import type { PrincipalKind } from '../presence/presence-state.js';

/** The roles a board token can carry, as the relay defines them. */
export const BOARD_TOKEN_ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;

/** One of {@link BOARD_TOKEN_ROLES}. */
export type BoardTokenRole = (typeof BOARD_TOKEN_ROLES)[number];

/** A board token's principal: a presence kind, or a demo board visitor. */
export type TokenPrincipalType = PrincipalKind | 'demo';

/**
 * What a board token says about its holder, read by the client without verifying the signature
 * (the relay verifies it on every connection). The client uses it for identity only: presence
 * is stamped with `principalId`, the token's `sub`, so it matches what the relay attributes
 * edits to.
 */
export interface BoardTokenClaims {
  /** The user's or agent's id: the token's `sub`. */
  readonly principalId: string;
  /**
   * Whether the holder is a person, an agent, a guest or a visitor to the public demo
   * board (read-only and never present): the token's `principal`.
   */
  readonly principalType: TokenPrincipalType;
  /** The board the token opens: the token's `boardId`. */
  readonly boardId: string;
  /** The holder's role on the board. */
  readonly role: BoardTokenRole;
  /** For an agent, the user operating it; absent for a user. */
  readonly operatorId?: string;
  /** Display name signed by the boards service; absent on older tokens. */
  readonly displayName?: string;
  /** When the token expires, in ms since the Unix epoch; absent when it carries no `exp`. */
  readonly expiresAt?: number;
  /**
   * The holder's (or, for an agent, its operator's) feature flags, as the boards service resolved
   * them when it signed the token: each flag's id to its value, as signed. The registry
   * is private (`@canvas/plans`), so a reader that needs the full set resolves it there
   * (`readFeatureSet`); absent on older tokens.
   */
  readonly features?: Readonly<Record<string, boolean | string>>;
  /**
   * The board's lock past its owner's plan: the owner's board limit, which a refused
   * edit names; absent on an editable board. The role is already capped.
   */
  readonly lock?: {
    /** The owner's board limit. */
    readonly boards: number;
  };
}

/**
 * Decodes a JWT segment (base64url, UTF-8 JSON).
 *
 * @param segment - The segment.
 * @returns The parsed JSON value.
 * @throws {RangeError} When the segment is not base64url-encoded JSON.
 */
function decodeSegment(segment: string): unknown {
  try {
    const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RangeError('A board token payload is base64url-encoded JSON.');
  }
}

/**
 * Tells whether a value is a non-empty string.
 *
 * @param value - The value.
 * @returns `true` for a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The `features` field of the claims, read leniently: the entries whose value is a boolean or a
 * string, as signed. The client never checks them against the flag registry, which is private.
 *
 * @param claim - The token's `features` claim.
 * @returns `{ features }`, or nothing when the claim is absent or not a plain object.
 */
function readFeatures(claim: unknown): { features?: Readonly<Record<string, boolean | string>> } {
  if (typeof claim !== 'object' || claim === null || Array.isArray(claim)) return {};
  const features: Record<string, boolean | string> = {};
  for (const [id, value] of Object.entries(claim as Record<string, unknown>)) {
    if (typeof value === 'boolean' || typeof value === 'string') features[id] = value;
  }
  return { features: Object.freeze(features) };
}

/**
 * The `lock` field of the claims, read leniently: a malformed one is none.
 *
 * @param claim - The token's `lock` claim.
 * @returns `{ lock }`, or nothing.
 */
function readLock(claim: unknown): { lock?: { readonly boards: number } } {
  const boards =
    typeof claim === 'object' && claim !== null
      ? (claim as { boards?: unknown }).boards
      : undefined;
  return Number.isSafeInteger(boards) && (boards as number) >= 0
    ? { lock: Object.freeze({ boards: boards as number }) }
    : {};
}

/**
 * Reads the claims of a board token (the relay's HS256 JWT: `sub`, `boardId`, `role`,
 * `principal`, `operatorId` for an agent, `exp`) without verifying its signature. The relay is
 * the only verifier; this is for the client's own identity (presence) and for failing fast on a
 * token for another board.
 *
 * @param token - The compact JWT.
 * @returns The claims, frozen.
 * @throws {RangeError} When the token is not a JWT, or a claim is missing or malformed.
 */
export function decodeBoardToken(token: string): BoardTokenClaims {
  const segments = token.split('.');
  const payloadSegment = segments.length === 3 ? segments[1] : undefined;
  if (payloadSegment === undefined) {
    throw new RangeError('A board token is a JWT: three dot-separated segments.');
  }
  const payload = decodeSegment(payloadSegment);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new RangeError('A board token payload is a JSON object.');
  }
  const { sub, boardId, role, principal, operatorId, exp, name, features, lock } =
    payload as Record<string, unknown>;
  const isRole = BOARD_TOKEN_ROLES.some((known) => known === role);
  const isPrincipal =
    principal === 'user' || principal === 'agent' || principal === 'guest' || principal === 'demo';
  const isOperatorValid =
    principal === 'agent' ? isNonEmptyString(operatorId) : operatorId === undefined;
  const isExpiryValid = exp === undefined || Number.isFinite(exp);
  if (
    !isNonEmptyString(sub) ||
    !isNonEmptyString(boardId) ||
    !isRole ||
    !isPrincipal ||
    !isOperatorValid ||
    !isExpiryValid ||
    (name !== undefined && typeof name !== 'string')
  ) {
    throw new RangeError(
      'A board token carries a sub, a boardId, a known role and principal, an operatorId ' +
        'exactly when the principal is an agent, and a numeric exp if any.',
    );
  }
  return Object.freeze({
    principalId: sub,
    ...(typeof name === 'string' ? { displayName: name } : {}),
    principalType: principal,
    boardId,
    role: role as BoardTokenRole,
    ...(typeof operatorId === 'string' ? { operatorId } : {}),
    ...(typeof exp === 'number' ? { expiresAt: exp * 1000 } : {}),
    ...readFeatures(features),
    ...readLock(lock),
  });
}
