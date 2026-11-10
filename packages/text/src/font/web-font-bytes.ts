// Shared by the web-font decoders: byte views, the size limit and sfnt tags.

import { FontFormatError } from './font-format-error.js';

/**
 * The most bytes a decoded font may hold, and any table or stream in it (64 MiB): far above any
 * real face (a full CJK face is about 20 MB), and low enough that a file declaring more is refused
 * before anything that large is allocated.
 */
export const MAX_DECODED_FONT_BYTES = 64 * 1024 * 1024;

/** A collection's flavor, `ttcf`. */
const COLLECTION_FLAVOR = 0x74746366;
/** The flavors a web font may wrap: one TrueType or CFF face. */
const FACE_FLAVORS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

/**
 * The bytes as one array, whatever they came as.
 *
 * @param bytes - A font file.
 * @returns A view of exactly its bytes.
 */
export function arrayOf(bytes: ArrayBufferLike | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

/**
 * A view of an array's bytes.
 *
 * @param array - The bytes.
 * @returns The view.
 */
export function viewOf(array: Uint8Array): DataView {
  return new DataView(array.buffer, array.byteOffset, array.byteLength);
}

/**
 * Refuses a declared size past {@link MAX_DECODED_FONT_BYTES}.
 *
 * @param size - The size.
 * @param what - What it is the size of, for the message.
 * @throws {FontFormatError} When it is too large.
 */
export function checkSize(size: number, what: string): void {
  if (size > MAX_DECODED_FONT_BYTES) {
    throw new FontFormatError(`The ${what} declares ${String(size)} bytes, past the limit.`);
  }
}

/**
 * Refuses a web font whose flavor is not an sfnt version it can wrap.
 *
 * @param flavor - The header's flavor.
 * @param format - The format, for the message.
 * @throws {FontFormatError} When it is neither TrueType nor CFF (a WOFF2 collection is refused
 *   with a message of its own).
 */
export function checkFlavor(flavor: number, format: string): void {
  if (format === 'WOFF2' && flavor === COLLECTION_FLAVOR) {
    throw new FontFormatError('WOFF2 collections are not supported; use a TTC or one face.');
  }
  if (!FACE_FLAVORS.has(flavor)) {
    throw new FontFormatError(
      `The ${format} flavor 0x${flavor.toString(16)} is not an sfnt version.`,
    );
  }
}

/**
 * A big-endian 32-bit tag from four characters.
 *
 * @param tag - The characters.
 * @returns The tag.
 */
export function tagValue(tag: string): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) value = value * 256 + tag.charCodeAt(index);
  return value;
}

/**
 * A tag as its four characters.
 *
 * @param tag - The tag.
 * @returns The characters.
 */
export function tagName(tag: number): string {
  return String.fromCharCode(
    (tag >>> 24) & 0xff,
    (tag >>> 16) & 0xff,
    (tag >>> 8) & 0xff,
    tag & 0xff,
  );
}
