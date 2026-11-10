import { OUTBOUND_CHUNK_BYTES, splitUpdate } from './split-update.js';

/**
 * The largest single transaction (or merge of whole transactions) the collab client sends whole,
 * in one message, bytes (7 MiB): under the relay's 8 MiB authenticated frame limit with
 * room for framing. The unit of sending is the transaction: a peer applies each message on its
 * own and its reference repair acts on what it sees, so a transaction is cut only when it cannot
 * travel whole, above this size, by struct ranges (`splitUpdate`).
 */
export const SINGLE_TRANSACTION_BYTES = 7 * 1024 * 1024;

/** How one transaction is sent. */
export interface TransactionChunks {
  /** The messages, in order: the transaction itself, or its struct-range chunks. */
  readonly chunks: readonly Uint8Array[];
  /** Whether it was cut by struct ranges, so peers see it in parts. */
  readonly isCut: boolean;
}

/**
 * The messages that carry one transaction: the transaction whole when it is at most
 * `maxWholeBytes`, else its struct-range chunks of at most `chunkBytes` each (`splitUpdate`).
 * Pure.
 *
 * @param update - The transaction's update (Yjs update format v1); not mutated.
 * @param maxWholeBytes - The largest sent whole; default {@link SINGLE_TRANSACTION_BYTES}.
 * @param chunkBytes - The chunk size when cut; default `OUTBOUND_CHUNK_BYTES`.
 * @returns The messages, and whether it was cut.
 * @throws {Error} When a transaction to cut is not a readable update.
 */
export function transactionChunks(
  update: Uint8Array,
  maxWholeBytes = SINGLE_TRANSACTION_BYTES,
  chunkBytes = OUTBOUND_CHUNK_BYTES,
): TransactionChunks {
  if (update.byteLength <= maxWholeBytes) return { chunks: [update], isCut: false };
  return { chunks: splitUpdate(update, chunkBytes), isCut: true };
}
