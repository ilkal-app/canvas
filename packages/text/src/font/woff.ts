// WOFF 1.0: each table a zlib stream, inflated by the platform's
// DecompressionStream, then laid out as the sfnt it came from.

import { FontFormatError } from './font-format-error.js';
import { type SfntTable, writeSfnt } from './sfnt-writer.js';
import { checkFlavor, checkSize, tagName, viewOf } from './web-font-bytes.js';

/** The bytes of a WOFF header and of one of its table directory entries. */
const WOFF_HEADER_BYTES = 44;
const WOFF_ENTRY_BYTES = 20;

/**
 * Unwraps a WOFF 1.0 file: each table inflated where it is compressed, then laid out as an sfnt
 * with the checksums the file records.
 *
 * @param source - The file.
 * @returns The sfnt.
 * @throws {FontFormatError} When the file is truncated or inconsistent, or a stream is corrupt.
 */
export async function decodeWoff(source: Uint8Array): Promise<Uint8Array> {
  if (source.length < WOFF_HEADER_BYTES) throw new FontFormatError('The WOFF header is truncated.');
  const view = viewOf(source);
  const flavor = view.getUint32(4);
  checkFlavor(flavor, 'WOFF');
  if (view.getUint32(8) !== source.length) {
    throw new FontFormatError('The WOFF header gives a length other than the file’s.');
  }
  const count = view.getUint16(12);
  checkSize(view.getUint32(16), 'WOFF header’s sfnt size');
  if (WOFF_HEADER_BYTES + count * WOFF_ENTRY_BYTES > source.length) {
    throw new FontFormatError('The WOFF table directory runs past the end of the file.');
  }
  // Every entry is checked before anything is inflated, so a file declaring more than the limit
  // allocates nothing.
  let total = 0;
  const tags = new Set<number>();
  const entries = Array.from({ length: count }, (unused, index) => {
    const entry = WOFF_HEADER_BYTES + index * WOFF_ENTRY_BYTES;
    const tag = view.getUint32(entry);
    if (tags.has(tag)) throw new FontFormatError('A table appears twice.');
    tags.add(tag);
    const offset = view.getUint32(entry + 4);
    const compressed = view.getUint32(entry + 8);
    const length = view.getUint32(entry + 12);
    checkSize(length, `WOFF table ${tagName(tag)}`);
    total += length;
    checkSize(total, 'WOFF file’s tables');
    if (offset + compressed > source.length) {
      throw new FontFormatError(`WOFF table ${tagName(tag)} runs past the end of the file.`);
    }
    if (compressed > length) {
      throw new FontFormatError(`WOFF table ${tagName(tag)} is longer compressed than whole.`);
    }
    return {
      tag,
      data: source.subarray(offset, offset + compressed),
      length,
      checksum: view.getUint32(entry + 16),
    };
  });
  const tables: SfntTable[] = [];
  for (const { tag, data, length, checksum } of entries) {
    tables.push({
      tag,
      bytes: data.length === length ? data.slice() : await inflate(data, length, tag),
      checksum,
    });
  }
  return writeSfnt(flavor, tables, false);
}

/** A read of a stream: a chunk, or the end. */
type StreamChunk =
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the platform's name for it
  | { readonly done: false; readonly value: Uint8Array }
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the platform's name for it
  | { readonly done: true };

/** The part of the Compression Streams API used here: browsers, workers and Node 18 have it. */
interface InflateStream {
  readonly readable: {
    getReader(): {
      read(): Promise<StreamChunk>;
      cancel(): Promise<void>;
    };
  };
  readonly writable: {
    getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> };
  };
}

/**
 * Inflates one zlib stream to exactly its declared length.
 *
 * @param data - The stream.
 * @param length - The bytes it must inflate to.
 * @param tag - Its table's tag, for the message.
 * @returns The inflated bytes.
 * @throws {FontFormatError} When the stream is corrupt or inflates to another length.
 */
async function inflate(data: Uint8Array, length: number, tag: number): Promise<Uint8Array> {
  const { DecompressionStream: decompression } = globalThis as {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- the platform's name for it
    readonly DecompressionStream?: new (format: 'deflate') => InflateStream;
  };
  if (decompression === undefined) {
    throw new FontFormatError('This platform cannot inflate WOFF tables.');
  }
  const stream = new decompression('deflate');
  const writer = stream.writable.getWriter();
  // A corrupt stream rejects these too; the read below reports it.
  writer.write(data.slice()).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const out = new Uint8Array(length);
  let at = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const { value } = chunk;
      if (at + value.length > length) {
        await reader.cancel().catch(() => undefined);
        throw new FontFormatError(`WOFF table ${tagName(tag)} inflates past its length.`);
      }
      out.set(value, at);
      at += value.length;
    }
  } catch (error) {
    if (error instanceof FontFormatError) throw error;
    throw new FontFormatError(`WOFF table ${tagName(tag)} is not a valid zlib stream.`);
  }
  if (at !== length) {
    throw new FontFormatError(`WOFF table ${tagName(tag)} inflates short of its length.`);
  }
  return out;
}
