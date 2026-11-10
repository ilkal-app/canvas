import { principalIdSchema, type PrincipalId } from '@canvas/schema';

/**
 * Who a transaction acts for: a person (`user`), an agent (`agent`), an
 * undo or redo of earlier changes (`undo`), or the product itself (`system`, for migrations,
 * imports and housekeeping).
 */
export const ORIGIN_KINDS = ['user', 'agent', 'undo', 'system'] as const;

/** One of {@link ORIGIN_KINDS}. */
export type OriginKind = (typeof ORIGIN_KINDS)[number];

/**
 * The origin every transaction carries. It is handed to Yjs as the
 * transaction origin, delivered with the transaction's change set, and is what undo
 * scopes history by. The principal matches the kind: `user:<id>` for `user`, `agent:<id>` for
 * `agent`, `system` for `system`, and for `undo` the user who undoes or redoes (undo
 * is per user), also when the step undone was the work of an agent they operate.
 */
export interface TransactionOrigin {
  /** What kind of actor made the change. */
  readonly kind: OriginKind;
  /** The principal the change is attributed to, in the schema's principal id format. */
  readonly principalId: PrincipalId;
  /**
   * The user operating an agent, for `agent` origins only, so the operator can undo the agent's
   * work; absent otherwise.
   */
  readonly operatorId?: PrincipalId;
  /**
   * Which of its caller's undo histories an agent's change belongs to, for `agent`
   * origins only, matching {@link HISTORY_KEY_PATTERN}: a history made with this key records
   * only the agent changes carrying it, and a history made without one only changes without a
   * key, so callers sharing one agent connection undo only their own work. Absent otherwise.
   */
  readonly historyKey?: string;
}

/** What a {@link TransactionOrigin.historyKey} matches: 1 to 64 letters, digits, `_` or `-`. */
export const HISTORY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The keys an origin may have. */
const ORIGIN_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'principalId',
  'operatorId',
  'historyKey',
]);

/** The origin of changes the product makes itself: `{ kind: 'system', principalId: 'system' }`. */
export const SYSTEM_ORIGIN: TransactionOrigin = Object.freeze({
  kind: 'system',
  principalId: 'system' as PrincipalId,
});

/**
 * Reads a principal id field of a candidate origin.
 *
 * @param candidate - The candidate origin.
 * @param field - Which field to read.
 * @returns The principal id, or `undefined` when the field is absent.
 * @throws {RangeError} When the field is present but is not a principal id.
 */
function readPrincipal(
  candidate: Readonly<Record<string, unknown>>,
  field: 'principalId' | 'operatorId',
): PrincipalId | undefined {
  const value = candidate[field];
  if (value === undefined) return undefined;
  const parsed = principalIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new RangeError(`Invalid transaction origin: ${field} ${JSON.stringify(value)}`);
  }
  return parsed.data;
}

/**
 * Tells whether a principal may act under an origin kind: `user:`, `guest:` (a guest of the
 * board) or `demo:` (a demo board visitor, whose writes the relay refuses) for
 * `user` and `undo` (the person who undoes), `agent:` for `agent`, and `system` for `system`.
 *
 * @param kind - The origin kind.
 * @param principalId - The principal.
 * @returns `true` when the principal matches the kind.
 */
function isPrincipalOfKind(kind: OriginKind, principalId: PrincipalId): boolean {
  if (kind === 'system') return principalId === 'system';
  // A person: one with an account, or a guest of the board, who edits and undoes alike;
  // a demo board visitor reads only, but its client still names an origin.
  if (kind === 'undo' || kind === 'user') {
    return ['user:', 'guest:', 'demo:'].some((prefix) => principalId.startsWith(prefix));
  }
  return principalId.startsWith(`${kind}:`);
}

/**
 * Reads the history key of a candidate origin, which only an `agent` origin may have.
 *
 * @param candidate - The candidate origin.
 * @param kind - Its kind, already validated.
 * @returns The key, or `undefined` when it has none.
 * @throws {RangeError} When it has a key that does not match {@link HISTORY_KEY_PATTERN}, or a
 *   key on a kind other than `agent`.
 */
function readHistoryKey(
  candidate: Readonly<Record<string, unknown>>,
  kind: OriginKind,
): string | undefined {
  const { historyKey } = candidate;
  if (historyKey === undefined) return undefined;
  if (typeof historyKey !== 'string' || !HISTORY_KEY_PATTERN.test(historyKey)) {
    throw new RangeError(`Invalid transaction origin: historyKey ${JSON.stringify(historyKey)}`);
  }
  if (kind !== 'agent') {
    throw new RangeError(`Invalid transaction origin: a ${kind} origin has no history key`);
  }
  return historyKey;
}

/**
 * Validates a transaction origin and returns a frozen copy of it.
 *
 * @param value - The candidate origin.
 * @returns The origin, frozen, sharing nothing with `value`.
 * @throws {RangeError} When `value` is not an origin, its principal does not match its kind,
 *   it has an operator that is not a user or on a kind other than `agent`, or a history key
 *   that does not match {@link HISTORY_KEY_PATTERN} or on a kind other than `agent`.
 */
export function parseTransactionOrigin(value: unknown): TransactionOrigin {
  if (typeof value !== 'object' || value === null) {
    throw new RangeError('Invalid transaction origin: not an object');
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  const unknownKeys = Object.keys(candidate).filter((key) => !ORIGIN_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new RangeError(`Invalid transaction origin: unknown keys ${unknownKeys.join(', ')}`);
  }
  const kind = ORIGIN_KINDS.find((known) => known === candidate.kind);
  if (kind === undefined) {
    throw new RangeError(`Invalid transaction origin: kind ${JSON.stringify(candidate.kind)}`);
  }
  const principalId = readPrincipal(candidate, 'principalId');
  if (principalId === undefined || !isPrincipalOfKind(kind, principalId)) {
    throw new RangeError(
      `Invalid transaction origin: a ${kind} origin cannot act for this principal`,
    );
  }
  const historyKey = readHistoryKey(candidate, kind);
  const keyed = historyKey === undefined ? {} : { historyKey };
  const operatorId = readPrincipal(candidate, 'operatorId');
  if (operatorId === undefined) return Object.freeze({ kind, principalId, ...keyed });
  if (kind !== 'agent') {
    throw new RangeError(`Invalid transaction origin: a ${kind} origin has no operator`);
  }
  if (!operatorId.startsWith('user:')) {
    throw new RangeError('Invalid transaction origin: an operator is a user');
  }
  return Object.freeze({ kind, principalId, operatorId, ...keyed });
}
