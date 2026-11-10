import * as decoding from 'lib0/decoding';

import {
  MalformedUpdateError,
  readByte,
  readCount,
  skipBytes,
  skipFixed,
} from './update-bounds.js';
import { MAX_UPDATE_VALUE_DEPTH, UpdateDepthError } from './update-depth.js';

// The struct and content numbers of Yjs update format v1, and a reader that skips an item's
// content in place, counting the clocks it spans (Yjs `readItemContent`, yjs 13.6
// src/structs/Item.js and the content classes), without decoding it. Split from
// `update-scan.ts`, which walks the structs.

/** A collected range (Yjs `GC`). */
export const GC_STRUCT = 0;
/** A skipped range (Yjs `Skip`): a range the update does not hold, left by `mergeUpdates`. */
export const SKIP_STRUCT = 10;

/** Content numbers of update format v1 (Yjs `contentRefs`). */
export const CONTENT_DELETED = 1;
/** JSON values, one string each (`ContentJSON`), which no current writer makes. */
export const CONTENT_JSON = 2;
const CONTENT_BINARY = 3;
const CONTENT_STRING = 4;
/** One JSON value (`ContentEmbed`), a rich-text embed. */
export const CONTENT_EMBED = 5;
/** A text format: a key and one JSON value (`ContentFormat`). */
export const CONTENT_FORMAT = 6;
/** A shared type (`ContentType`). */
export const CONTENT_TYPE = 7;
/** Plain values (`ContentAny`). */
export const CONTENT_ANY = 8;
const CONTENT_DOC = 9;

/** The type numbers of `Y.XmlElement` and `Y.XmlHook`, which carry a node name. */
const XML_ELEMENT_TYPE = 3;
const XML_HOOK_TYPE = 5;

/** What an item's content spans, written by {@link skipContent}; reused to avoid allocations. */
export interface ContentExtent {
  /** The clocks the content spans. */
  length: number;
  /**
   * For plain values and JSON: where they start (at their count); for an embed: where its JSON
   * string starts; for a format: where its key starts (its JSON value follows); for a shared
   * type: its number.
   */
  detail: number;
}

/** lib0 `any` tags (lib0 `writeAny`). */
const OBJECT_TAG = 118;
const ARRAY_TAG = 117;

/**
 * Skips a lib0 varInt or varUint: bytes with the high bit set, then one without.
 *
 * @param decoder - Positioned at the number.
 * @throws {MalformedUpdateError} `truncated` when the number runs past the end.
 */
function skipVarNumber(decoder: decoding.Decoder): void {
  while ((readByte(decoder) & 0x80) !== 0);
}

/**
 * Skips a lib0 `any` value (lib0 `readAny`): its tag byte and payload. Every call consumes at
 * least one byte or throws, and every count is at most the bytes left, so the work is bounded
 * by the update's length; the recursion is bounded by {@link MAX_UPDATE_VALUE_DEPTH}.
 *
 * @param decoder - Positioned at the value's tag.
 * @param depth - Number of enclosing plain object/array containers.
 * @throws {UpdateDepthError} Before descending beyond the supported nesting bound.
 * @throws {MalformedUpdateError} When the value runs past the end, declares more entries than
 *   the bytes left, or has a tag lib0 does not write (lib0's `readAny` fails on those too).
 */
function skipAny(decoder: decoding.Decoder, depth = 0): void {
  const offset = decoder.pos;
  const tag = readByte(decoder);
  if ((tag === OBJECT_TAG || tag === ARRAY_TAG) && depth >= MAX_UPDATE_VALUE_DEPTH) {
    throw new UpdateDepthError();
  }
  switch (tag) {
    case 125:
      skipVarNumber(decoder);
      return;
    case 124:
      skipFixed(decoder, 4);
      return;
    case 123:
    case 122:
      skipFixed(decoder, 8);
      return;
    case 119:
    case 116:
      skipBytes(decoder);
      return;
    case OBJECT_TAG:
      for (let count = readCount(decoder); count > 0; count -= 1) {
        skipBytes(decoder);
        skipAny(decoder, depth + 1);
      }
      return;
    case ARRAY_TAG:
      for (let count = readCount(decoder); count > 0; count -= 1) skipAny(decoder, depth + 1);
      return;
    case 127:
    case 126:
    case 121:
    case 120:
      // undefined, null, false, true: no payload.
      return;
    default:
      throw new MalformedUpdateError('unknown-value', offset);
  }
}

/**
 * Skips a lib0 string and counts its UTF-16 code units, which is what an item's length counts,
 * without decoding it: every UTF-8 lead byte is one unit, a four-byte sequence two.
 *
 * @param decoder - Positioned at the string's byte length.
 * @returns The string's length in UTF-16 code units.
 */
function skipStringCountingUnits(decoder: decoding.Decoder): number {
  const start = skipBytes(decoder);
  let units = 0;
  for (const byte of decoder.arr.subarray(start, decoder.pos)) {
    if ((byte & 0xc0) !== 0x80) units += byte >= 0xf0 ? 2 : 1;
  }
  return units;
}

/**
 * Reads past an item's content, writing the clocks it spans and its detail into `extent`.
 *
 * @param decoder - Positioned at the content, after the item's neighbours and parent.
 * @param kind - The content number from the item's info byte.
 * @param extent - Where the length and detail are written; changed in place.
 * @throws {RangeError} When the content number is not one of update format v1.
 * @throws {MalformedUpdateError} When the content runs past the end of the bytes or declares
 *   more entries than the bytes left.
 * @throws {UpdateDepthError} When a plain value nests deeper than the bound.
 */
export function skipContent(decoder: decoding.Decoder, kind: number, extent: ContentExtent): void {
  extent.length = 1;
  extent.detail = 0;
  switch (kind) {
    case CONTENT_DELETED:
      extent.length = decoding.readVarUint(decoder);
      return;
    case CONTENT_JSON: {
      extent.detail = decoder.pos;
      const count = readCount(decoder);
      extent.length = count;
      for (let index = 0; index < count; index += 1) skipBytes(decoder);
      return;
    }
    case CONTENT_EMBED:
      extent.detail = decoder.pos;
      skipBytes(decoder);
      return;
    case CONTENT_BINARY:
      skipBytes(decoder);
      return;
    case CONTENT_STRING:
      extent.length = skipStringCountingUnits(decoder);
      return;
    case CONTENT_FORMAT:
      extent.detail = decoder.pos;
      skipBytes(decoder);
      skipBytes(decoder);
      return;
    case CONTENT_TYPE:
      extent.detail = decoding.readVarUint(decoder);
      if (extent.detail === XML_ELEMENT_TYPE || extent.detail === XML_HOOK_TYPE) skipBytes(decoder);
      return;
    case CONTENT_ANY: {
      extent.detail = decoder.pos;
      const count = readCount(decoder);
      extent.length = count;
      for (let index = 0; index < count; index += 1) skipAny(decoder);
      return;
    }
    case CONTENT_DOC:
      skipBytes(decoder);
      skipAny(decoder);
      return;
    default:
      throw new RangeError(`unknown Yjs content ${String(kind)}`);
  }
}
