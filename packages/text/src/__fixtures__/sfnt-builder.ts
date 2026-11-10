// Builds small synthetic sfnt files, so each table reader can be tested on the exact cases a
// real font may not contain (cmap format 12, composite scales, kern subtable flags).

/** Appends big-endian fields, as every sfnt table stores them. */
export class ByteWriter {
  private readonly bytes: number[] = [];

  /**
   * The bytes written so far.
   *
   * @returns A copy of the bytes.
   */
  toBytes(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.bytes);
  }

  /**
   * The number of bytes written so far.
   *
   * @returns The length in bytes.
   */
  get length(): number {
    return this.bytes.length;
  }

  /**
   * Appends unsigned 8-bit values.
   *
   * @param values - The values.
   * @returns This writer.
   */
  u8(...values: number[]): this {
    for (const value of values) this.bytes.push(value & 0xff);
    return this;
  }

  /**
   * Appends 16-bit values, signed or unsigned.
   *
   * @param values - The values.
   * @returns This writer.
   */
  u16(...values: number[]): this {
    for (const value of values) this.bytes.push((value >> 8) & 0xff, value & 0xff);
    return this;
  }

  /**
   * Appends 32-bit values.
   *
   * @param values - The values.
   * @returns This writer.
   */
  u32(...values: number[]): this {
    for (const value of values) this.u16(Math.floor(value / 0x10000) & 0xffff, value & 0xffff);
    return this;
  }

  /**
   * Appends 4 ASCII characters.
   *
   * @param tag - The tag.
   * @returns This writer.
   */
  tag(tag: string): this {
    for (const character of tag) this.u8(character.charCodeAt(0));
    return this;
  }

  /**
   * Appends raw bytes.
   *
   * @param bytes - The bytes.
   * @returns This writer.
   */
  raw(bytes: Uint8Array): this {
    for (const byte of bytes) this.bytes.push(byte);
    return this;
  }
}

/**
 * Wraps tables in an sfnt table directory (TrueType version 0x00010000).
 *
 * @param tables - Each table's tag and bytes.
 * @returns The font file.
 */
export function buildSfnt(tables: Readonly<Record<string, Uint8Array>>): ArrayBuffer {
  const entries = Object.entries(tables);
  const directory = new ByteWriter().u32(0x00010000).u16(entries.length, 0, 0, 0);
  let offset = 12 + entries.length * 16;
  const body = new ByteWriter();
  for (const [tag, bytes] of entries) {
    directory.tag(tag).u32(0, offset, bytes.length);
    body.raw(bytes);
    offset += bytes.length;
  }
  const file = new ByteWriter().raw(directory.toBytes()).raw(body.toBytes()).toBytes();
  return file.buffer;
}
