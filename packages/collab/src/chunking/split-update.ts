import * as Y from 'yjs';

import { planStructChunks } from './struct-chunk-plan.js';
import { encodedStructBytes, encodeStructChunk, splitDeleteSet } from './update-encoding.js';

/**
 * The chunk size of the collab client's sync messages, bytes (1 MiB): whole
 * transactions are merged into messages of at most this size, and a transaction cut by struct
 * ranges is cut into pieces of at most this size. A single transaction larger than this goes
 * whole, alone, up to `SINGLE_TRANSACTION_BYTES` (7 MiB), under the relay's 8 MiB authenticated
 * frame limit.
 */
export const OUTBOUND_CHUNK_BYTES = 1024 * 1024;

/**
 * Splits an update (Yjs update format v1) larger than `maxBytes` into several, each at most
 * `maxBytes` (a single struct larger than that, which is never cut, travels alone in
 * its own), that the relay applies one after another to the same result as the whole: the
 * structs by client clock ranges, ordered so every chunk applies on what the relay holds plus
 * the chunks before it with nothing left pending (`planStructChunks`), then the delete set in
 * updates of their own. A writer's layout stamp travels in the first chunk that carries that
 * writer's structs, before its objects. An update within the limit is returned as it is. Pure:
 * never mutates its input. Main thread or worker.
 *
 * The struct ranges are ordered by Yjs dependencies, not by the transactions that wrote them,
 * so a chunk boundary can fall inside a transaction, and peers then see its first part, for as
 * long as the next chunk takes (a whole backoff when the connection drops between them). An
 * editor peer's reference repair acts on what it sees: a child whose new parent is in the next
 * chunk is re-rooted, a connector whose targets are is deleted, and those repairs are writes
 * that stay. So the client uses it only where nothing else can carry the update
 * (`UnsentChangesSplitWarning`): a single transaction above `SINGLE_TRANSACTION_BYTES` (7 MiB;
 * smaller ones travel whole, `transactionChunks`), and a reconnect no replay covers (a cache an
 * older build compacted with unsent work in it, an unreadable log, a cache without
 * `readUpdates`, edits whose bytes a read-only connection dropped and whose records were
 * compacted). Unsent transactions are otherwise replayed whole (`planStoredReplay`). Within one
 * transaction the cut follows Yjs's order, which need not put referents first.
 *
 * @param update - The update; not mutated.
 * @param maxBytes - The chunk limit, bytes; default {@link OUTBOUND_CHUNK_BYTES}.
 * @returns The chunks, in sending order; `[update]` when it fits.
 * @throws {Error} When the bytes are not a readable update.
 */
export function splitUpdate(update: Uint8Array, maxBytes = OUTBOUND_CHUNK_BYTES): Uint8Array[] {
  if (update.byteLength <= maxBytes) return [update];
  const { structs, ds } = Y.decodeUpdate(update);
  const chunks = planStructChunks(structs, maxBytes, encodedStructBytes).map(encodeStructChunk);
  return [...chunks, ...splitDeleteSet(ds, maxBytes)];
}
