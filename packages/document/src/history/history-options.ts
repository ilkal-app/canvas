import { principalIdSchema, type PrincipalId } from '@canvas/schema';

import { HISTORY_KEY_PATTERN } from '../origin/transaction-origin.js';

import type { OperatedWriters } from './operated-writes.js';
import type { UndoHistoryOptions } from './undo-history.js';

// The checks `createHistory` makes of its arguments (`undo-manager.ts`).

/** The principals a history may be for: the people a `user` origin acts for (`isPrincipalOfKind`). */
const PERSON_PREFIXES = ['user:', 'guest:', 'demo:'] as const;

/**
 * Reads the principal a history is for, which must be a person (undo is per user): one with
 * an account, a guest of the board, or a demo board visitor, whose history
 * stays empty since it edits nothing.
 *
 * @param principalId - The candidate principal.
 * @returns The principal.
 * @throws {RangeError} When it is not a person's principal id.
 */
export function readUserPrincipal(principalId: PrincipalId): PrincipalId {
  const parsed = principalIdSchema.safeParse(principalId);
  if (!parsed.success || !PERSON_PREFIXES.some((prefix) => parsed.data.startsWith(prefix))) {
    throw new RangeError(`An undo history belongs to a user, not ${JSON.stringify(principalId)}`);
  }
  return parsed.data;
}

/**
 * Reads the capture window.
 *
 * @param captureTimeout - The candidate window, ms.
 * @returns The window, ms.
 * @throws {RangeError} When it is negative or not finite.
 */
export function readCaptureTimeout(captureTimeout: number): number {
  if (!Number.isFinite(captureTimeout) || captureTimeout < 0) {
    throw new RangeError(
      `The capture window must be a finite ms count ≥ 0, not ${String(captureTimeout)}`,
    );
  }
  return captureTimeout;
}

/** A history's validated options. */
export interface HistoryCapture {
  /** The capture window, ms. */
  readonly captureTimeout: number;
  /** Which agent changes the history records; `undefined` for those without a key. */
  readonly historyKey: string | undefined;
  /** Which client ids write for agents the user operates; `undefined` for none. */
  readonly operatedWriters: OperatedWriters | undefined;
}

/**
 * Reads a history's options.
 *
 * @param options - The candidate options.
 * @returns The capture window (default 0), the history key and the operated writers.
 * @throws {RangeError} When the capture window is negative or not finite, or the key does not
 *   match `HISTORY_KEY_PATTERN`.
 * @throws {TypeError} When `operatedWriters` is given without its two functions.
 */
export function readHistoryCapture(options: UndoHistoryOptions): HistoryCapture {
  const { operatedWriters } = options as { readonly operatedWriters?: Partial<OperatedWriters> };
  if (
    operatedWriters !== undefined &&
    (typeof operatedWriters.records !== 'function' || typeof operatedWriters.owns !== 'function')
  ) {
    throw new TypeError('operatedWriters has records and owns, functions of a Yjs client id');
  }
  return {
    captureTimeout: readCaptureTimeout(options.captureTimeout ?? 0),
    historyKey: readHistoryKey(options.historyKey),
    operatedWriters: operatedWriters as OperatedWriters | undefined,
  };
}

/**
 * Reads a history's key.
 *
 * @param historyKey - The candidate key, or `undefined` for an unkeyed history; any value, since
 *   untyped callers reach it.
 * @returns The key, or `undefined`.
 * @throws {RangeError} When it is not a string matching `HISTORY_KEY_PATTERN`.
 */
function readHistoryKey(historyKey: unknown): string | undefined {
  if (historyKey === undefined) return undefined;
  // `RegExp.test` would coerce a non-string from untyped callers.
  if (typeof historyKey === 'string' && HISTORY_KEY_PATTERN.test(historyKey)) return historyKey;
  throw new RangeError(
    `A history key matches ${String(HISTORY_KEY_PATTERN)}, not ${JSON.stringify(historyKey)}`,
  );
}
