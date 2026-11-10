import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import type { StructChunk, UpdateStruct } from './struct-chunk-plan.js';

// Re-encoding parts of a decoded update as updates of their own (Yjs update format v1), the
// way Yjs's own `mergeUpdates` writes structs (`struct.write(encoder, offset)`) and delete sets
// (`writeDeleteSet`): a struct is written whole, never cut.

/** A Yjs delete set, as `Y.decodeUpdate` returns it; yjs exports the factory, not the class. */
export type DeleteSet = ReturnType<typeof Y.createDeleteSet>;

/** A deleted range: its first clock and its length. */
interface DeletedRange {
  readonly clock: number;
  readonly len: number;
}

/**
 * The bytes a varuint takes.
 *
 * @param value - A non-negative integer below 2^53.
 * @returns Its encoded length, 1 to 8 bytes.
 */
function varUintBytes(value: number): number {
  let bytes = 1;
  for (let rest = value; rest > 127; rest = Math.floor(rest / 128)) bytes += 1;
  return bytes;
}

/**
 * A struct's encoded size in update format v1, bytes, measured by writing it alone (v1 keeps no
 * state between structs, so sizes add up).
 *
 * @param struct - The struct.
 * @returns Its size.
 */
export function encodedStructBytes(struct: UpdateStruct): number {
  const encoder = new Y.UpdateEncoderV1();
  struct.write(encoder, 0);
  return encoding.length(encoder.restEncoder);
}

/**
 * Encodes one chunk of structs as an update with an empty delete set, clients in descending
 * order as Yjs writes them.
 *
 * @param chunk - Each client's consecutive structs.
 * @returns The update.
 */
export function encodeStructChunk(chunk: StructChunk): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  const runs = [...chunk].sort(([first], [second]) => second - first);
  encoding.writeVarUint(encoder.restEncoder, runs.length);
  for (const [client, structs] of runs) {
    encoding.writeVarUint(encoder.restEncoder, structs.length);
    encoder.writeClient(client);
    // A run is consecutive clocks from its first struct's, the least.
    const firstClock = structs.reduce(
      (least, struct) => Math.min(least, struct.id.clock),
      Infinity,
    );
    encoding.writeVarUint(encoder.restEncoder, firstClock);
    for (const struct of structs) struct.write(encoder, 0);
  }
  encoding.writeVarUint(encoder.restEncoder, 0);
  return encoder.toUint8Array();
}

/**
 * Encodes part of a delete set as an update with no structs.
 *
 * @param clients - Each client's deleted ranges.
 * @returns The update.
 */
function encodeDeleteChunk(clients: ReadonlyMap<number, readonly DeletedRange[]>): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  encoding.writeVarUint(encoder.restEncoder, 0);
  encoding.writeVarUint(encoder.restEncoder, clients.size);
  for (const [client, ranges] of clients) {
    encoder.resetDsCurVal();
    encoding.writeVarUint(encoder.restEncoder, client);
    encoding.writeVarUint(encoder.restEncoder, ranges.length);
    for (const range of ranges) {
      encoder.writeDsClock(range.clock);
      encoder.writeDsLen(range.len);
    }
  }
  return encoder.toUint8Array();
}

/**
 * Splits a delete set into updates with no structs, each at most `maxBytes` (one range always
 * fits). Applied after the structs they delete, they leave nothing pending.
 *
 * @param deleteSet - The delete set; not mutated.
 * @param maxBytes - The chunk limit, bytes.
 * @returns The updates, clients in descending order; none for an empty delete set.
 */
export function splitDeleteSet(deleteSet: DeleteSet, maxBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let current = new Map<number, DeletedRange[]>();
  // The structs' count (0) and the delete set's client count, at most 5 bytes.
  let bytes = 6;
  const clients = [...deleteSet.clients].sort(([first], [second]) => second - first);
  for (const [client, ranges] of clients) {
    for (const range of ranges) {
      const rangeBytes = varUintBytes(range.clock) + varUintBytes(range.len);
      if (current.size > 0 && bytes + rangeBytes + (current.has(client) ? 0 : 10) > maxBytes) {
        chunks.push(encodeDeleteChunk(current));
        current = new Map();
        bytes = 6;
      }
      const list = current.get(client);
      // A client's first range in a chunk also writes its id and range count, 5 bytes each.
      bytes += rangeBytes + (list === undefined ? 10 : 0);
      if (list === undefined) current.set(client, [range]);
      else list.push(range);
    }
  }
  if (current.size > 0) chunks.push(encodeDeleteChunk(current));
  return chunks;
}
