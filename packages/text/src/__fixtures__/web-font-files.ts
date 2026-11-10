// Synthetic WOFF and WOFF2 files for the web-font decoders' tests: builders for
// files, a transformed glyf and its streams, and readers for what the decoders write back.
import { readFileSync } from 'node:fs';
import { brotliCompressSync, deflateSync } from 'node:zlib';

import { expect } from 'vitest';

import { FontFormatError } from '../font/font-format-error.js';
import { decodeWebFont } from '../font/web-font.js';

/** The TrueType sfnt version, the flavor the builders write by default. */
export const TRUETYPE = 0x00010000;

/**
 * Reads a corpus file.
 *
 * @param name - Its name.
 * @returns Its bytes.
 */
export function corpus(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(new URL(`./format-corpus/${name}`, import.meta.url)));
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
 * A 16-bit value's big-endian bytes.
 *
 * @param value - The value.
 * @returns Its two bytes.
 */
export function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * A 32-bit value's big-endian bytes.
 *
 * @param value - The value.
 * @returns Its four bytes.
 */
export function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * A UIntBase128.
 *
 * @param value - The value.
 * @returns Its bytes.
 */
export function base128(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    out.unshift(rest % 128);
    rest = Math.floor(rest / 128);
  } while (rest > 0);
  return out.map((byte, index) => (index < out.length - 1 ? byte | 0x80 : byte));
}

/**
 * A 255UInt16, in the form the value picks.
 *
 * @param value - The value.
 * @returns Its bytes.
 */
export function uint255(value: number): number[] {
  if (value < 253) return [value];
  if (value < 506) return [255, value - 253];
  if (value < 762) return [254, value - 506];
  return [253, ...u16(value)];
}

/** One table of a synthetic WOFF. */
export interface WoffTable {
  readonly tag: string;
  readonly data: Uint8Array;
  /** Whether to store it zlib-compressed (by default when that is smaller). */
  readonly isCompressed?: boolean;
  /** The length to declare instead of the data's. */
  readonly length?: number;
}

/**
 * A WOFF 1.0 file.
 *
 * @param tables - Its tables.
 * @param flavor - Its sfnt version.
 * @returns The file.
 */
export function woffFile(tables: readonly WoffTable[], flavor = TRUETYPE): Uint8Array {
  const stored = tables.map(({ data, isCompressed }) =>
    isCompressed === false ? data : Uint8Array.from(deflateSync(data)),
  );
  let size = 44 + 20 * tables.length;
  const offsets = stored.map((data) => {
    const offset = size;
    size += Math.ceil(data.length / 4) * 4;
    return offset;
  });
  const out = new Uint8Array(size);
  out.set([...u32(0x774f4646), ...u32(flavor), ...u32(size), ...u16(tables.length), 0, 0], 0);
  out.set(u32(1000), 16);
  tables.forEach(({ tag, data, length }, index) => {
    const entry = 44 + 20 * index;
    const offset = offsets[index] ?? 0;
    const bytes = stored[index] ?? new Uint8Array(0);
    out.set(
      [...u32(tagValue(tag)), ...u32(offset), ...u32(bytes.length), ...u32(length ?? data.length)],
      entry,
    );
    out.set(bytes, offset);
  });
  return out;
}

/** One table of a synthetic WOFF2. */
export interface Woff2Table {
  /** Its tag, as characters or as a number (for one no characters spell). */
  readonly tag: string | number;
  readonly data: Uint8Array;
  /** Its transform version (0 by default). */
  readonly version?: number;
  /** Its length in the font, when it differs from the data's (a transformed table). */
  readonly length?: number;
}

/**
 * A WOFF2 file, every table named by an arbitrary tag.
 *
 * @param tables - Its tables.
 * @param options - The file's flavor, or a stream to use in place of the tables' compressed bytes.
 * @param options.flavor - Its sfnt version.
 * @param options.stream - The compressed stream to write instead.
 * @returns The file.
 */
export function woff2File(
  tables: readonly Woff2Table[],
  { flavor = TRUETYPE, stream }: { readonly flavor?: number; readonly stream?: Uint8Array } = {},
): Uint8Array {
  const directory = tables.flatMap(({ tag, data, version = 0, length }) => {
    const value = typeof tag === 'string' ? tagValue(tag) : tag;
    const isGlyphTable = value === tagValue('glyf') || value === tagValue('loca');
    const isTransformed = isGlyphTable ? version !== 3 : version !== 0;
    return [
      (version << 6) | 0x3f,
      ...u32(value),
      ...base128(length ?? data.length),
      ...(isTransformed ? base128(data.length) : []),
    ];
  });
  const raw = new Uint8Array(tables.reduce((sum, { data }) => sum + data.length, 0));
  let at = 0;
  for (const { data } of tables) {
    raw.set(data, at);
    at += data.length;
  }
  const compressed = stream ?? Uint8Array.from(brotliCompressSync(raw));
  const size = 48 + directory.length + compressed.length;
  const out = new Uint8Array(size);
  out.set([...u32(0x774f4632), ...u32(flavor), ...u32(size), ...u16(tables.length), 0, 0], 0);
  out.set([...u32(1000), ...u32(compressed.length)], 16);
  out.set(directory, 48);
  out.set(compressed, 48 + directory.length);
  return out;
}

/** The streams of a transformed `glyf`, as bytes (contour counts as numbers). */
export interface GlyfStreams {
  readonly contours: readonly number[];
  readonly points?: readonly number[];
  readonly flags?: readonly number[];
  readonly glyphs?: readonly number[];
  readonly composites?: readonly number[];
  readonly boxBitmap?: readonly number[];
  readonly boxes?: readonly number[];
  readonly instructions?: readonly number[];
  readonly overlap?: readonly number[];
  readonly indexFormat?: number;
}

/**
 * A transformed `glyf` (WOFF2 §5.1).
 *
 * @param streams - Its streams.
 * @returns The table.
 */
export function transformedGlyf(streams: GlyfStreams): Uint8Array {
  const glyphCount = streams.contours.length;
  const bitmap = streams.boxBitmap ?? new Array<number>(4 * Math.ceil(glyphCount / 32)).fill(0);
  const parts = [
    streams.contours.flatMap(u16),
    streams.points ?? [],
    streams.flags ?? [],
    streams.glyphs ?? [],
    streams.composites ?? [],
    [...bitmap, ...(streams.boxes ?? []).flatMap(u16)],
    streams.instructions ?? [],
  ];
  return Uint8Array.from([
    ...u16(0),
    ...u16(streams.overlap === undefined ? 0 : 1),
    ...u16(glyphCount),
    ...u16(streams.indexFormat ?? 1),
    ...parts.flatMap((part) => u32(part.length)),
    ...parts.flat(),
    ...(streams.overlap ?? []),
  ]);
}

/**
 * A WOFF2 file holding a transformed glyf and its loca, and any other tables.
 *
 * @param streams - The glyf's streams.
 * @param others - Other tables.
 * @returns The file.
 */
export function glyphFile(streams: GlyfStreams, others: readonly Woff2Table[] = []): Uint8Array {
  const locaLength = (streams.contours.length + 1) * ((streams.indexFormat ?? 1) === 0 ? 2 : 4);
  return woff2File([
    { tag: 'glyf', data: transformedGlyf(streams), length: 1 },
    { tag: 'loca', data: new Uint8Array(0), length: locaLength },
    ...others,
  ]);
}

/**
 * A table of a decoded sfnt.
 *
 * @param sfnt - The file.
 * @param tag - The table's tag.
 * @returns Its bytes.
 * @throws {Error} When the file has no such table.
 */
export function tableOf(sfnt: Uint8Array, tag: string): Uint8Array {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + index * 16;
    if (view.getUint32(record) === tagValue(tag)) {
      const offset = view.getUint32(record + 8);
      return sfnt.subarray(offset, offset + view.getUint32(record + 12));
    }
  }
  throw new Error(`No ${tag} table.`);
}

/** A TrueType simple glyph, read back. */
export interface SimpleGlyph {
  readonly box: readonly number[];
  readonly ends: readonly number[];
  readonly instructions: readonly number[];
  readonly flags: readonly number[];
  readonly points: readonly (readonly [number, number])[];
}

/**
 * Reads a TrueType simple glyph.
 *
 * @param bytes - Its bytes.
 * @returns The glyph.
 */
export function readSimpleGlyph(bytes: Uint8Array): SimpleGlyph {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const contours = view.getInt16(0);
  const box = [2, 4, 6, 8].map((offset) => view.getInt16(offset));
  const ends = Array.from({ length: contours }, (unused, index) => view.getUint16(10 + index * 2));
  let at = 10 + contours * 2;
  const instructionLength = view.getUint16(at);
  at += 2;
  const instructions = [...bytes.subarray(at, at + instructionLength)];
  at += instructionLength;
  const count = (ends.at(-1) ?? -1) + 1;
  const flags = [...bytes.subarray(at, at + count)];
  at += count;
  const read = (short: number, same: number): number[] => {
    let value = 0;
    return flags.map((flag) => {
      if ((flag & short) !== 0) {
        const delta = view.getUint8(at);
        at += 1;
        value += (flag & same) !== 0 ? delta : -delta;
      } else if ((flag & same) === 0) {
        value += view.getInt16(at);
        at += 2;
      }
      return value;
    });
  };
  const xs = read(0x02, 0x10);
  const ys = read(0x04, 0x20);
  return { box, ends, instructions, flags, points: xs.map((x, index) => [x, ys[index] ?? 0]) };
}

/**
 * Expects decoding to reject with a FontFormatError whose message matches.
 *
 * @param bytes - The file.
 * @param message - What the message must hold.
 */
export async function expectRefusal(bytes: Uint8Array, message: RegExp): Promise<void> {
  const refusal = decodeWebFont(bytes);
  await expect(refusal).rejects.toBeInstanceOf(FontFormatError);
  await expect(refusal).rejects.toThrow(message);
}
