import * as Y from 'yjs';

import { OUTBOUND_CHUNK_BYTES } from './split-update.js';
import { SINGLE_TRANSACTION_BYTES, transactionChunks } from './transaction-chunks.js';

/** What a replay of the stored transactions sends, and where it leaves the relay. */
export interface StoredReplay {
  /**
   * The updates to send, in order: whole transactions merged up to the chunk size, a larger
   * transaction alone and whole up to `SINGLE_TRANSACTION_BYTES`, and only a transaction above
   * that cut by struct ranges.
   */
  readonly chunks: readonly Uint8Array[];
  /** Whether some transaction was above `SINGLE_TRANSACTION_BYTES` and cut by struct ranges. */
  readonly isCut: boolean;
  /**
   * Each client's clock the relay holds once the chunks are applied: the relay's state vector
   * raised by every replayed transaction. What the store holds beyond it (edits made while the
   * log was read) and the store's delete set still have to follow.
   */
  readonly coveredStateVector: ReadonlyMap<number, number>;
}

/**
 * Merges consecutive parts (each one transaction) into chunks of at most `maxBytes`, cutting only
 * between parts; a part, or a merge, above `maxBytes` goes whole and alone up to `maxWholeBytes`,
 * and only above that is it cut by struct ranges (`transactionChunks`).
 *
 * @param parts - The parts, in order.
 * @param maxBytes - The chunk size, bytes.
 * @param maxWholeBytes - The largest part sent whole, bytes.
 * @returns The chunks, and whether a part was cut.
 */
function coalesce(
  parts: readonly Uint8Array[],
  maxBytes: number,
  maxWholeBytes: number,
): { chunks: Uint8Array[]; isCut: boolean } {
  const chunks: Uint8Array[] = [];
  let isCut = false;
  let pending: Uint8Array[] = [];
  let bytes = 0;
  const flush = (): void => {
    const [first, ...rest] = pending;
    if (first === undefined) return;
    const merged = rest.length === 0 ? first : Y.mergeUpdates(pending);
    const sent = transactionChunks(merged, maxWholeBytes, maxBytes);
    chunks.push(...sent.chunks);
    isCut ||= sent.isCut;
    pending = [];
    bytes = 0;
  };
  for (const part of parts) {
    if (bytes + part.byteLength > maxBytes) flush();
    pending.push(part);
    bytes += part.byteLength;
  }
  flush();
  return { chunks, isCut };
}

/**
 * Plans the answer to the relay's state vector from the stored transactions, when the
 * store's whole difference is larger than one chunk: the cache's log holds each transaction's
 * update in the order it was made, so replaying the ones the relay lacks, each cut to what the
 * relay lacks (`Y.diffUpdate`) and merged with its neighbours up to `maxBytes`, sends the
 * offline work in causal order, every chunk boundary between two transactions (a transaction
 * larger than `maxBytes` goes alone and whole, and only one above `maxWholeBytes` is cut by
 * struct ranges), so a peer never sees part of a
 * transaction whose references its repair would act on. A transaction that only deletes travels
 * with the store's delete set after the rest, not in its place: nothing depends on it. A
 * writer's stamp is in
 * its first transaction, so it travels in or before the chunk with its first objects. The relay
 * applies them in order and idempotently, so overlap is harmless.
 *
 * A logged update holding structs the store does not (written after `localStateVector` was
 * read, or by another tab) is skipped. The replay covers the store only when, for every client,
 * the replayed transactions reach the store's clock without a gap; otherwise (the earlier edits
 * were compacted into the snapshot, or came from a snapshot or another tab) it returns
 * `undefined`: the caller tries the next source (the cache's log after the queue in memory) and,
 * last, splits the whole difference by struct ranges (`splitUpdate`). Pure:
 * never mutates its inputs. Main thread or worker.
 *
 * @param log - The board's stored updates since its snapshot, oldest first.
 * @param remoteStateVector - The relay's state vector, from its sync step 1.
 * @param localStateVector - The store's state vector when the answer was planned.
 * @param maxBytes - The chunk size, bytes; default {@link OUTBOUND_CHUNK_BYTES}.
 * @param maxWholeBytes - The largest transaction sent whole, bytes; default
 *   {@link SINGLE_TRANSACTION_BYTES}.
 * @returns The chunks and where they leave the relay, or `undefined` when the log cannot cover
 *   the store.
 * @throws {Error} When a stored update or a state vector cannot be read.
 */
export function planStoredReplay(
  log: readonly Uint8Array[],
  remoteStateVector: Uint8Array,
  localStateVector: Uint8Array,
  maxBytes = OUTBOUND_CHUNK_BYTES,
  maxWholeBytes = SINGLE_TRANSACTION_BYTES,
): StoredReplay | undefined {
  const covered = Y.decodeStateVector(remoteStateVector);
  const local = Y.decodeStateVector(localStateVector);
  const parts: Uint8Array[] = [];
  for (const record of log) {
    const { to } = Y.parseUpdateMeta(record);
    if ([...to].some(([client, clock]) => clock > (local.get(client) ?? 0))) continue;
    const part = Y.diffUpdate(record, Y.encodeStateVector(covered));
    const lacking = Y.parseUpdateMeta(part);
    if (lacking.to.size === 0) continue;
    // Clocks between what the relay holds and this transaction were never logged: a gap.
    if ([...lacking.from].some(([client, clock]) => clock > (covered.get(client) ?? 0))) {
      return undefined;
    }
    parts.push(part);
    for (const [client, clock] of lacking.to) covered.set(client, clock);
  }
  for (const [client, clock] of local) {
    if (clock > (covered.get(client) ?? 0)) return undefined;
  }
  return { ...coalesce(parts, maxBytes, maxWholeBytes), coveredStateVector: covered };
}
