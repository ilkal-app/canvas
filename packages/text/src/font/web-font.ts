// Web fonts: WOFF 1.0 and WOFF2 unwrap to the sfnt they carry before anything reads
// them, so the parser, HarfBuzz and the engine's jobs only ever see ordinary font files. WOFF's
// tables are zlib streams, inflated by the platform's DecompressionStream; WOFF2's are one brotli
// stream, decoded by brotli's JavaScript decoder, imported only when a WOFF2 arrives, and its
// `glyf`, `loca` and (optionally) `hmtx` tables are rebuilt from their transformed forms.

import { FontFormatError } from './font-format-error.js';
import { arrayOf, checkSize, viewOf } from './web-font-bytes.js';
import { decodeWoff } from './woff.js';
import { decodeWoff2 } from './woff2.js';

export { MAX_DECODED_FONT_BYTES } from './web-font-bytes.js';

/** The signatures of a WOFF and a WOFF2 file, `wOFF` and `wOF2`. */
const WOFF_SIGNATURE = 0x774f4646;
const WOFF2_SIGNATURE = 0x774f4632;
/** The sfnt versions a font file may start with: TrueType, `true`, `OTTO` and a `ttcf` collection. */
const SFNT_SIGNATURES = new Set([0x00010000, 0x74727565, 0x4f54544f, 0x74746366]);

/**
 * Which web format a font file is: its first four bytes, `wOFF` or `wOF2`.
 *
 * @param bytes - The file.
 * @returns `'woff'`, `'woff2'`, or `undefined` for anything else.
 */
export function webFontFormatOf(
  bytes: ArrayBufferLike | ArrayBufferView,
): 'woff' | 'woff2' | undefined {
  const array = arrayOf(bytes);
  if (array.length < 4) return undefined;
  const signature = new DataView(array.buffer, array.byteOffset, 4).getUint32(0);
  if (signature === WOFF_SIGNATURE) return 'woff';
  return signature === WOFF2_SIGNATURE ? 'woff2' : undefined;
}

/**
 * The sfnt a font file carries: a WOFF or WOFF2 file unwrapped into an ordinary font
 * file, or a copy of a font file that already is one (TrueType, CFF or a collection). A WOFF's
 * tables keep their bytes; a WOFF2's `glyf`, `loca` and `hmtx` are rebuilt as equivalent tables,
 * and its `head` takes the new file's checksum adjustment. The input is never changed.
 *
 * @param bytes - The font file.
 * @returns The sfnt's bytes.
 * @throws {FontFormatError} (as a rejection) When the file is truncated or inconsistent, larger
 *   than the limit, a stream
 *   is corrupt, a declared size passes `MAX_DECODED_FONT_BYTES`, the file is a WOFF2
 *   collection, or it is not a font file at all.
 */
export async function decodeWebFont(bytes: ArrayBufferLike | ArrayBufferView): Promise<Uint8Array> {
  const source = arrayOf(bytes);
  const format = webFontFormatOf(source);
  if (format === 'woff') return decodeWoff(source);
  if (format === 'woff2') return decodeWoff2(source);
  if (source.length >= 4 && SFNT_SIGNATURES.has(viewOf(source).getUint32(0))) {
    checkSize(source.length, 'font file');
    return source.slice();
  }
  throw new FontFormatError('The file is not a font: no sfnt, WOFF or WOFF2 signature.');
}
