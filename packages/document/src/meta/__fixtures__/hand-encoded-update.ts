// Yjs updates (format v1) written byte by byte, for the relay's stamp check tests:
// what a hostile client can send that no Yjs document would produce, such as an item whose
// neighbour is missing or collected, a skipped range, or a client listed twice.
import * as encoding from 'lib0/encoding';
import type * as Y from 'yjs';

/** What a hand-written item holds. */
export type HandContent =
  | { readonly kind: 'any'; readonly values: readonly unknown[] }
  | { readonly kind: 'map' }
  | { readonly kind: 'deleted'; readonly length: number }
  | { readonly kind: 'string'; readonly text: string };

/** One hand-written item. Parent and key are written only when it names neither neighbour. */
export interface HandItem {
  readonly origin?: Y.ID;
  readonly rightOrigin?: Y.ID;
  /** A top-level type's name, or the id of the nested type's item. */
  readonly parent?: string | Y.ID;
  readonly parentSub?: string;
  readonly content: HandContent;
}

/** A struct of a hand-written update: an item, a skipped range or a collected range. */
export type HandStruct = HandItem | { readonly skip: number } | { readonly gc: number };

/** One client's run of structs, from a first clock. */
export interface HandBlock {
  readonly client: number;
  readonly clock: number;
  readonly structs: readonly HandStruct[];
}

/** One client's deleted ranges, as `[clock, length]` pairs. */
export interface HandDeletes {
  readonly client: number;
  readonly ranges: readonly (readonly [number, number])[];
}

/** The content numbers of update format v1. */
const CONTENT_NUMBER = { deleted: 1, string: 4, map: 7, any: 8 } as const;

/**
 * Writes one item's info byte, neighbours, parent and content.
 *
 * @param encoder - Where to write.
 * @param item - The item.
 */
function writeItem(encoder: encoding.Encoder, item: HandItem): void {
  const hasParent = item.origin === undefined && item.rightOrigin === undefined;
  const info =
    (item.origin === undefined ? 0 : 0b1000_0000) |
    (item.rightOrigin === undefined ? 0 : 0b0100_0000) |
    (hasParent && item.parentSub !== undefined ? 0b0010_0000 : 0) |
    CONTENT_NUMBER[item.content.kind];
  encoding.writeUint8(encoder, info);
  for (const id of [item.origin, item.rightOrigin]) {
    if (id === undefined) continue;
    encoding.writeVarUint(encoder, id.client);
    encoding.writeVarUint(encoder, id.clock);
  }
  if (hasParent) {
    const { parent = 'objects' } = item;
    if (typeof parent === 'string') {
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarString(encoder, parent);
    } else {
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarUint(encoder, parent.client);
      encoding.writeVarUint(encoder, parent.clock);
    }
    if (item.parentSub !== undefined) encoding.writeVarString(encoder, item.parentSub);
  }
  const { content } = item;
  if (content.kind === 'any') {
    encoding.writeVarUint(encoder, content.values.length);
    for (const value of content.values) encoding.writeAny(encoder, value as never);
  } else if (content.kind === 'map') {
    encoding.writeVarUint(encoder, 1);
  } else if (content.kind === 'deleted') {
    encoding.writeVarUint(encoder, content.length);
  } else {
    encoding.writeVarString(encoder, content.text);
  }
}

/**
 * Encodes an update from hand-written blocks, in the order given (a client may be listed twice,
 * which Yjs reads as its last block only).
 *
 * @param blocks - Each client's run of structs.
 * @param deletes - The delete set.
 * @returns The update's bytes.
 */
export function encodeHandUpdate(
  blocks: readonly HandBlock[],
  deletes: readonly HandDeletes[] = [],
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, blocks.length);
  for (const block of blocks) {
    encoding.writeVarUint(encoder, block.structs.length);
    encoding.writeVarUint(encoder, block.client);
    encoding.writeVarUint(encoder, block.clock);
    for (const struct of block.structs) {
      if ('skip' in struct) {
        encoding.writeUint8(encoder, 10);
        encoding.writeVarUint(encoder, struct.skip);
      } else if ('gc' in struct) {
        encoding.writeUint8(encoder, 0);
        encoding.writeVarUint(encoder, struct.gc);
      } else {
        writeItem(encoder, struct);
      }
    }
  }
  encoding.writeVarUint(encoder, deletes.length);
  for (const { client, ranges } of deletes) {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, ranges.length);
    for (const [clock, length] of ranges) {
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarUint(encoder, length);
    }
  }
  return encoding.toUint8Array(encoder);
}
