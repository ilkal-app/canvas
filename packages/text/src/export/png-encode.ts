// A minimal PNG and base64 encoder: a bitmap colour glyph's raw pixels written as an
// RGBA PNG, with stored (uncompressed) deflate blocks, so an export embeds it without a codec.
// Pure.

/** The PNG signature. */
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The largest stored deflate block. */
const MAX_STORED_BLOCK = 0xffff;

/**
 * The CRC-32 table (polynomial 0xEDB88320).
 *
 * @returns The 256 entries.
 */
function crcTable(): DataView {
  const table = new DataView(new ArrayBuffer(256 * 4));
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table.setUint32(index * 4, value >>> 0);
  }
  return table;
}

/** The CRC-32 table, built once. */
const CRC_TABLE = crcTable();

/**
 * The CRC-32 of some bytes, as PNG chunks carry it.
 *
 * @param bytes - The bytes.
 * @returns The checksum.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE.getUint32(((crc ^ byte) & 0xff) * 4) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The Adler-32 of some bytes, as a zlib stream ends with.
 *
 * @param bytes - The bytes.
 * @returns The checksum.
 */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * A number as four big-endian bytes.
 *
 * @param value - The number.
 * @returns The bytes.
 */
function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * One PNG chunk: length, type, data and CRC.
 *
 * @param type - The four-letter type.
 * @param data - The data.
 * @returns The chunk's bytes.
 */
function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array(type.length);
  for (let index = 0; index < type.length; index += 1) typed[index] = type.charCodeAt(index);
  const body = new Uint8Array([...typed, ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/**
 * A zlib stream holding the bytes in stored deflate blocks.
 *
 * @param bytes - The bytes.
 * @returns The stream.
 */
function storedZlib(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let start = 0; start === 0 || start < bytes.length; start += MAX_STORED_BLOCK) {
    const block = bytes.subarray(start, start + MAX_STORED_BLOCK);
    const isLast = start + MAX_STORED_BLOCK >= bytes.length;
    const length = block.length;
    out.push(isLast ? 1 : 0, length & 0xff, length >>> 8, ~length & 0xff, (~length >>> 8) & 0xff);
    out.push(...block);
  }
  out.push(...u32(adler32(bytes)));
  return Uint8Array.from(out);
}

/**
 * Raw BGRA pixels (as a bitmap strike holds them) as an RGBA PNG file.
 *
 * @param bgra - The pixels, four bytes each, rows top to bottom.
 * @param width - The width in pixels.
 * @param height - The height in pixels.
 * @returns The PNG file.
 */
export function bgraToPng(bgra: Uint8Array, width: number, height: number): Uint8Array {
  const rows = new Uint8Array(height * (width * 4 + 1));
  const pixels = new DataView(bgra.buffer, bgra.byteOffset, bgra.byteLength);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = row + 1 + x * 4;
      rows[to] = pixels.getUint8(from + 2);
      rows[to + 1] = pixels.getUint8(from + 1);
      rows[to + 2] = pixels.getUint8(from);
      rows[to + 3] = pixels.getUint8(from + 3);
    }
  }
  const header = Uint8Array.from([...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
  return Uint8Array.from([
    ...SIGNATURE,
    ...chunk('IHDR', header),
    ...chunk('IDAT', storedZlib(rows)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The base64 alphabet. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Bytes as base64, for data URLs.
 *
 * @param bytes - The bytes.
 * @returns The base64 text, padded.
 */
export function base64Of(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const left = bytes.length - index;
    const view = new DataView(bytes.buffer, bytes.byteOffset + index, Math.min(3, left));
    const byteAt = (offset: number) => (offset < left ? view.getUint8(offset) : 0);
    const triple = (byteAt(0) << 16) | (byteAt(1) << 8) | byteAt(2);
    out += BASE64.charAt((triple >>> 18) & 63);
    out += BASE64.charAt((triple >>> 12) & 63);
    out += left > 1 ? BASE64.charAt((triple >>> 6) & 63) : '=';
    out += left > 2 ? BASE64.charAt(triple & 63) : '=';
  }
  return out;
}
