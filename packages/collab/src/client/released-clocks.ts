import * as Y from 'yjs';

/**
 * Detects integrated clocks supplied by retained history rather than the received update.
 * Yjs update structs are ordered by ascending clock within each client; Skip records are
 * gaps, not supplied history. Unlike encodeStateVectorFromUpdate, this accepts incremental
 * ranges starting above zero without scanning or encoding the document's full struct store.
 *
 * @param before - Integrated clocks before applying the update.
 * @param after - Integrated clocks after applying the update.
 * @param update - The received update, already accepted by the document boundary.
 * @returns Whether some newly integrated clock is absent from the received history.
 */
export function hasReleasedClocks(
  before: Uint8Array,
  after: Uint8Array,
  update: Uint8Array,
): boolean {
  const covered = Y.decodeStateVector(before);
  const integrated = Y.decodeStateVector(after);
  for (const struct of Y.decodeUpdate(update).structs) {
    if (struct instanceof Y.Skip) continue;
    const client = struct.id.client;
    const cursor = covered.get(client) ?? 0;
    const end = integrated.get(client) ?? 0;
    if (cursor >= end) continue;
    if (struct.id.clock > cursor) return true;
    covered.set(client, Math.max(cursor, struct.id.clock + struct.length));
  }
  for (const [client, clock] of integrated) {
    if (clock > (covered.get(client) ?? 0)) return true;
  }
  return false;
}
