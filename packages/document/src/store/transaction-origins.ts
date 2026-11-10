import {
  parseTransactionOrigin,
  SYSTEM_ORIGIN,
  type TransactionOrigin,
} from '../origin/transaction-origin.js';

/** Validated origins issued by one store, distinguished from Yjs's own transactions. */
export class TransactionOrigins {
  readonly #issued = new WeakSet<TransactionOrigin>();

  /**
   * Validates and remembers a caller's origin.
   *
   * @param origin - The candidate origin.
   * @returns The frozen validated origin.
   */
  issue(origin: TransactionOrigin): TransactionOrigin {
    const valid = parseTransactionOrigin(origin);
    this.#issued.add(valid);
    return valid;
  }

  /**
   * Attributes an event to an issued origin, or the system for a Yjs-created transaction.
   *
   * @param origin - The transaction's origin.
   * @returns The origin to report.
   */
  of(origin: unknown): TransactionOrigin {
    const candidate = origin as TransactionOrigin;
    return typeof origin === 'object' && origin !== null && this.#issued.has(candidate)
      ? candidate
      : SYSTEM_ORIGIN;
  }
}
