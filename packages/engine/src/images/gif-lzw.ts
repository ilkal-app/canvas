/** The largest code a GIF's LZW stream uses: codes are at most 12 bits. */
const MAX_CODES = 4096;

/**
 * Decodes one GIF image's LZW data (GIF89a, appendix F) into colour indices, row by row as
 * stored. A stream that ends early leaves the rest of the pixels at index 0, and one with more
 * data than pixels is cut, as browsers decode a damaged frame. Pure: the input is not changed.
 *
 * @param minCodeSize - The stream's minimum code size, 2 to 8 bits (the byte before the data).
 * @param data - The image data, its sub-blocks joined.
 * @param pixelCount - The image's width × height.
 * @returns One colour index per pixel.
 * @throws {RangeError} When the minimum code size is outside 2 to 8, or a code is impossible.
 */
export function decodeGifLzw(
  minCodeSize: number,
  data: Uint8Array,
  pixelCount: number,
): Uint8Array {
  if (!Number.isInteger(minCodeSize) || minCodeSize < 2 || minCodeSize > 8) {
    throw new RangeError(`A GIF's LZW code size is 2 to 8 bits; received ${String(minCodeSize)}.`);
  }
  const output = new Uint8Array(pixelCount);
  const input = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const table = new CodeTable(clearCode);
  let codeSize = minCodeSize + 1;
  let nextCode = clearCode + 2;
  let previous = -1;
  let written = 0;
  let bits = 0;
  let bitCount = 0;
  let offset = 0;
  while (written < pixelCount) {
    while (bitCount < codeSize && offset < data.length) {
      bits |= input.getUint8(offset) << bitCount;
      bitCount += 8;
      offset += 1;
    }
    if (bitCount < codeSize) break;
    const code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize;
    bitCount -= codeSize;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = clearCode + 2;
      previous = -1;
      continue;
    }
    if (code === endCode) break;
    if (previous < 0) {
      if (code > endCode) throw new RangeError('A GIF frame starts with an undefined code.');
      output[written] = code;
      written += 1;
      previous = code;
      continue;
    }
    if (code > nextCode) throw new RangeError('A GIF frame uses an LZW code it has not defined.');
    // A new code is the previous string plus the first byte of this one (or of itself, KwKwK).
    // A full table takes no new code until the next clear code (a "deferred clear").
    if (nextCode < MAX_CODES) {
      table.add(nextCode, previous, table.firstByte(code < nextCode ? code : previous));
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    written = table.write(code, output, written);
    previous = code;
  }
  return output;
}

/** Each code's string, as the code it extends (prefix), its last byte and its length. */
class CodeTable {
  private readonly prefixes = new DataView(new ArrayBuffer(MAX_CODES * 2));
  private readonly suffixes = new DataView(new ArrayBuffer(MAX_CODES));
  private readonly lengths = new DataView(new ArrayBuffer(MAX_CODES * 2));

  /**
   * Creates the table with its one-byte codes.
   *
   * @param clearCode - The clear code: the codes below it are single bytes.
   */
  constructor(clearCode: number) {
    for (let code = 0; code < clearCode; code += 1) {
      this.suffixes.setUint8(code, code);
      this.lengths.setUint16(code * 2, 1);
    }
  }

  /**
   * Defines a code as another code's string plus one byte.
   *
   * @param code - The new code.
   * @param prefix - The code it extends.
   * @param suffix - Its last byte.
   */
  add(code: number, prefix: number, suffix: number): void {
    this.prefixes.setUint16(code * 2, prefix);
    this.suffixes.setUint8(code, suffix);
    this.lengths.setUint16(code * 2, this.lengths.getUint16(prefix * 2) + 1);
  }

  /**
   * The first byte of a code's string.
   *
   * @param code - The code.
   * @returns The byte.
   */
  firstByte(code: number): number {
    let current = code;
    while (this.lengths.getUint16(current * 2) > 1) current = this.prefixes.getUint16(current * 2);
    return this.suffixes.getUint8(current);
  }

  /**
   * Writes a code's string at an offset, cut at the output's end.
   *
   * @param code - The code.
   * @param output - The indices.
   * @param offset - Where its first byte goes.
   * @returns The offset after it.
   */
  write(code: number, output: Uint8Array, offset: number): number {
    const length = this.lengths.getUint16(code * 2);
    let current = code;
    for (let index = length - 1; index >= 0; index -= 1) {
      if (offset + index < output.length) output[offset + index] = this.suffixes.getUint8(current);
      current = this.prefixes.getUint16(current * 2);
    }
    return Math.min(output.length, offset + length);
  }
}
