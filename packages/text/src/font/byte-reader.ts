// The WOFF2 decoder's reader: big-endian values and WOFF2's variable-length
// integers, every read checked against the end.

import { FontFormatError } from './font-format-error.js';
import { viewOf } from './web-font-bytes.js';

/**
 * Reads big-endian values and WOFF2's variable-length integers from bytes, refusing any read past
 * their end.
 */
export class ByteReader {
  private readonly view: DataView;

  /**
   * Starts reading.
   *
   * @param bytes - The bytes.
   * @param at - Where to start.
   */
  constructor(
    private readonly bytes: Uint8Array,
    public at = 0,
  ) {
    this.view = viewOf(bytes);
  }

  /**
   * How many bytes are left.
   *
   * @returns The count.
   */
  get remaining(): number {
    return this.bytes.length - this.at;
  }

  /**
   * Advances past bytes that must be there.
   *
   * @param count - How many.
   * @returns Where they start.
   * @throws {FontFormatError} When they run past the end.
   */
  private take(count: number): number {
    if (count > this.remaining) throw new FontFormatError('A WOFF2 structure is truncated.');
    const start = this.at;
    this.at += count;
    return start;
  }

  /**
   * Reads a byte.
   *
   * @returns The next byte.
   */
  uint8(): number {
    return this.view.getUint8(this.take(1));
  }

  /**
   * Reads an unsigned 16-bit value.
   *
   * @returns The next big-endian 16-bit value.
   */
  uint16(): number {
    return this.view.getUint16(this.take(2));
  }

  /**
   * Reads a signed 16-bit value.
   *
   * @returns The next big-endian signed 16-bit value.
   */
  int16(): number {
    return this.view.getInt16(this.take(2));
  }

  /**
   * Reads an unsigned 32-bit value.
   *
   * @returns The next big-endian 32-bit value.
   */
  uint32(): number {
    return this.view.getUint32(this.take(4));
  }

  /**
   * The next bytes.
   *
   * @param count - How many.
   * @returns A view of them.
   */
  slice(count: number): Uint8Array {
    const start = this.take(count);
    return this.bytes.subarray(start, start + count);
  }

  /**
   * The bytes read since a position.
   *
   * @param start - The position.
   * @returns A view of them.
   */
  since(start: number): Uint8Array {
    return this.bytes.subarray(start, this.at);
  }

  /**
   * The next UIntBase128: up to five bytes of seven bits each, most significant first, with no
   * leading zero byte and no value past 32 bits.
   *
   * @returns The value.
   * @throws {FontFormatError} When it is malformed.
   */
  base128(): number {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.uint8();
      if (index === 0 && byte === 0x80)
        throw new FontFormatError('A WOFF2 number has a leading zero.');
      if (value >= 2 ** 25) throw new FontFormatError('A WOFF2 number overflows 32 bits.');
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new FontFormatError('A WOFF2 number runs past five bytes.');
  }

  /**
   * The next 255UInt16: a byte under 253 is its value; 253 is followed by a 16-bit value, 255 by
   * a byte added to 253 and 254 by a byte added to 506.
   *
   * @returns The value.
   */
  uint255(): number {
    const code = this.uint8();
    if (code === 253) return this.uint16();
    if (code === 255) return 253 + this.uint8();
    if (code === 254) return 506 + this.uint8();
    return code;
  }
}
