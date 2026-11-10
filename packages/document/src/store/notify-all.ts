import type * as Y from 'yjs';

import type { TransactionOrigin } from '../origin/transaction-origin.js';

import type { DocumentUpdate } from './document-store.js';

/**
 * Calls every listener with a value, even when one throws, then rethrows the first error.
 *
 * @param listeners - The listeners, copied before the first call so unsubscribing is safe.
 * @param value - The value to deliver.
 * @throws {unknown} The first error a listener threw.
 */
export function notifyAll<Value>(
  listeners: ReadonlySet<(value: Value) => void>,
  value: Value,
): void {
  const errors: unknown[] = [];
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}

/**
 * The handler of a Yjs document's `update` event that delivers each transaction's update, with
 * the store's origin, to the update listeners.
 *
 * @param listeners - The update listeners.
 * @param originOf - The store's origin of a Yjs transaction origin.
 * @returns The handler.
 */
export function updateNotifier(
  listeners: ReadonlySet<(update: DocumentUpdate) => void>,
  originOf: (origin: unknown) => TransactionOrigin,
): (update: Uint8Array, origin: unknown, doc: Y.Doc, transaction: Y.Transaction) => void {
  return (update, origin, doc, transaction) => {
    notifyAll(
      listeners,
      Object.freeze({ update, origin: originOf(origin), isLocal: transaction.local }),
    );
  };
}
