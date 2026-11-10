import * as decoding from 'lib0/decoding';
import { decodeUtf8 } from 'lib0/string';

// Bounded reads for the update scan. lib0's `readUint8` does not check the end of
// the bytes: past it, it returns `undefined` and moves on. A scan that trusts a declared count
// would then loop that many times over nothing: 15 bytes declaring 2^49 plain values froze the
// process. Every read here refuses to pass the end, and every count is checked against the
// bytes left, so the scan's work is bounded by the update's length.

/**
 * Why the scan refused bytes: `truncated` when a read would pass their end, `count-exceeds-bytes`
 * when a declared count is larger than the bytes left (every entry takes at least one byte),
 * `unknown-value` when a plain value's tag is not one lib0 writes.
 */
export type MalformedUpdateCause = 'truncated' | 'count-exceeds-bytes' | 'unknown-value';

/**
 * Update bytes the scan cannot read within their length. The message names only the cause and
 * a byte offset, never peer content. A `RangeError`, as Yjs's own decoder throws for bytes it
 * cannot read.
 */
export class MalformedUpdateError extends RangeError {
  /** Why the bytes were refused. */
  readonly code: MalformedUpdateCause;

  /**
   * Creates the refusal.
   *
   * @param code - Why the bytes were refused.
   * @param offset - The byte offset where the scan stopped.
   */
  constructor(code: MalformedUpdateCause, offset: number) {
    super(`malformed update: ${code} at byte ${String(offset)}`);
    this.name = 'MalformedUpdateError';
    this.code = code;
  }
}

/**
 * The bytes left after the decoder's position.
 *
 * @param decoder - The decoder.
 * @returns How many bytes can still be read (zero past the end).
 */
function bytesLeft(decoder: decoding.Decoder): number {
  return Math.max(0, decoder.arr.length - decoder.pos);
}

/**
 * Reads one byte, refusing to read past the end (lib0's `readUint8` returns `undefined` there).
 *
 * @param decoder - The decoder.
 * @returns The byte.
 * @throws {MalformedUpdateError} `truncated` at the end of the bytes.
 */
export function readByte(decoder: decoding.Decoder): number {
  if (bytesLeft(decoder) === 0) throw new MalformedUpdateError('truncated', decoder.pos);
  return decoding.readUint8(decoder);
}

/**
 * Reads a count of entries that follow, each at least one byte long.
 *
 * @param decoder - Positioned at the count (a varUint).
 * @returns The count, at most the bytes left after it.
 * @throws {MalformedUpdateError} `count-exceeds-bytes` for a count the bytes cannot hold.
 * @throws {Error} lib0's "Unexpected end of array" when the count itself is cut off.
 */
export function readCount(decoder: decoding.Decoder): number {
  const count = decoding.readVarUint(decoder);
  if (count > bytesLeft(decoder)) {
    throw new MalformedUpdateError('count-exceeds-bytes', decoder.pos);
  }
  return count;
}

/**
 * Moves past `length` bytes, refusing to move past the end.
 *
 * @param decoder - The decoder.
 * @param length - How many bytes to skip.
 * @throws {MalformedUpdateError} `truncated` when fewer bytes are left.
 */
export function skipFixed(decoder: decoding.Decoder, length: number): void {
  if (length > bytesLeft(decoder)) throw new MalformedUpdateError('truncated', decoder.pos);
  decoder.pos += length;
}

/**
 * Skips a length-prefixed byte string (a lib0 string or byte array) without copying it.
 *
 * @param decoder - Positioned at the byte length.
 * @returns Where the string's bytes start.
 * @throws {MalformedUpdateError} `truncated` when the length passes the end.
 */
export function skipBytes(decoder: decoding.Decoder): number {
  // Read the length first: `pos += read()` would add it to the position before the read.
  const length = decoding.readVarUint(decoder);
  const start = decoder.pos;
  skipFixed(decoder, length);
  return start;
}

/**
 * Reads a string only after its declared byte range has been bounded. lib0's fallback
 * decoder may otherwise loop over an unchecked length when TextDecoder is unavailable.
 *
 * @param decoder - Positioned at the string's byte length.
 * @returns The decoded string.
 * @throws {MalformedUpdateError} When the declared bytes pass the input's end.
 * @throws {Error} When its length or UTF-8 encoding cannot be decoded.
 */
export function readBoundedString(decoder: decoding.Decoder): string {
  const start = skipBytes(decoder);
  return decodeUtf8(decoder.arr.subarray(start, decoder.pos));
}
