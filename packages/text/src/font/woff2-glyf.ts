// WOFF2's transformed glyf (WOFF2 §5.1): seven streams rebuilt into TrueType glyf
// and loca tables.

import { ByteReader } from './byte-reader.js';
import { FontFormatError } from './font-format-error.js';
import { checkSize, viewOf } from './web-font-bytes.js';

/** A rebuilt `glyf` and its `loca`, with each glyph's xMin for the `hmtx` transform. */
export interface RebuiltGlyphs {
  readonly glyf: Uint8Array;
  readonly loca: Uint8Array;
  readonly xMins: readonly number[];
}

/** TrueType simple-glyph flags. */
const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
const OVERLAP_SIMPLE = 0x40;
/** TrueType composite-glyph flags. */
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

/**
 * Rebuilds `glyf` and `loca` from WOFF2's transformed `glyf` (WOFF2 §5.1): its seven streams of
 * contour counts, point counts, flags, coordinates, composites, bounding boxes and instructions.
 *
 * @param data - The transformed table.
 * @returns The tables, and each glyph's xMin.
 * @throws {FontFormatError} When a stream is truncated or the table is inconsistent.
 */
export function rebuildGlyphs(data: Uint8Array): RebuiltGlyphs {
  const header = new ByteReader(data);
  header.uint16();
  const options = header.uint16();
  const glyphCount = header.uint16();
  const indexFormat = header.uint16();
  const sizes = Array.from({ length: 7 }, () => header.uint32());
  const streams = sizes.map((size) => new ByteReader(header.slice(size)));
  const [contours, points, flags, glyphs, composites, boxes, instructions] = streams as [
    ByteReader,
    ByteReader,
    ByteReader,
    ByteReader,
    ByteReader,
    ByteReader,
    ByteReader,
  ];
  const bitmapBytes = 4 * Math.ceil(glyphCount / 32);
  const boxBitmap = boxes.slice(bitmapBytes);
  const overlapBitmap = (options & 1) === 1 ? header.slice(Math.ceil(glyphCount / 8)) : undefined;
  const hasBit = (bitmap: Uint8Array, glyph: number): boolean =>
    ((bitmap[glyph >> 3] ?? 0) & (0x80 >> (glyph & 7))) !== 0;

  const parts: { readonly bytes: Uint8Array; readonly offset: number }[] = [];
  const offsets: number[] = [0];
  const xMins: number[] = [];
  let size = 0;
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    const contourCount = contours.int16();
    const hasBox = hasBit(boxBitmap, glyph);
    let out: Uint8Array;
    if (contourCount === 0) {
      if (hasBox) throw new FontFormatError('An empty WOFF2 glyph has a bounding box.');
      out = new Uint8Array(0);
      xMins.push(0);
    } else if (contourCount > 0) {
      out = simpleGlyph(
        contourCount,
        { points, flags, glyphs, instructions },
        hasBox ? boxes : undefined,
        overlapBitmap !== undefined && hasBit(overlapBitmap, glyph),
      );
      xMins.push(viewOf(out).getInt16(2));
    } else if (contourCount === -1) {
      if (!hasBox) throw new FontFormatError('A WOFF2 composite glyph has no bounding box.');
      out = compositeGlyph(composites, glyphs, instructions, boxes);
      xMins.push(viewOf(out).getInt16(2));
    } else {
      throw new FontFormatError('A WOFF2 glyph has a negative contour count other than -1.');
    }
    parts.push({ bytes: out, offset: size });
    // Each glyph starts on a 4-byte boundary (2 would do for a short loca; 4 suits both).
    size += Math.ceil(out.length / 4) * 4;
    checkSize(size, 'rebuilt glyf');
    offsets.push(size);
  }
  const glyf = new Uint8Array(size);
  for (const { bytes, offset } of parts) glyf.set(bytes, offset);
  const isLong = indexFormat !== 0;
  if (!isLong && size > 0x1fffe) {
    throw new FontFormatError('The rebuilt glyf is too long for a short loca.');
  }
  const loca = new Uint8Array(offsets.length * (isLong ? 4 : 2));
  const locaView = viewOf(loca);
  offsets.forEach((offset, index) => {
    if (isLong) locaView.setUint32(index * 4, offset);
    else locaView.setUint16(index * 2, offset / 2);
  });
  return { glyf, loca, xMins };
}

/** The streams a simple glyph reads. */
interface SimpleStreams {
  readonly points: ByteReader;
  readonly flags: ByteReader;
  readonly glyphs: ByteReader;
  readonly instructions: ByteReader;
}

/**
 * One coordinate delta's sign: a flag's lowest bit set means positive.
 *
 * @param flag - The flag (shifted for y).
 * @param value - The magnitude.
 * @returns The signed delta.
 */
function withSign(flag: number, value: number): number {
  return (flag & 1) !== 0 ? value : -value;
}

/** A point of a simple glyph, in font units. */
interface GlyphPoint {
  readonly x: number;
  readonly y: number;
  readonly isOnCurve: boolean;
}

/**
 * Decodes a simple glyph's points from their flags and coordinate triplets (WOFF2 §5.2): each
 * flag's low seven bits pick how many bytes its delta takes and how they split between x and y,
 * its two lowest bits the signs; the top bit marks an off-curve point.
 *
 * @param flags - One flag per point.
 * @param glyphs - The glyph stream, at the glyph's triplets.
 * @returns The points, in absolute coordinates.
 * @throws {FontFormatError} When the triplets run past the stream.
 */
function readPoints(flags: Uint8Array, glyphs: ByteReader): GlyphPoint[] {
  const points: GlyphPoint[] = [];
  let x = 0;
  let y = 0;
  for (const raw of flags) {
    const flag = raw & 0x7f;
    let dx: number;
    let dy: number;
    if (flag < 10) {
      dx = 0;
      dy = withSign(flag, ((flag & 14) << 7) + glyphs.uint8());
    } else if (flag < 20) {
      dx = withSign(flag, (((flag - 10) & 14) << 7) + glyphs.uint8());
      dy = 0;
    } else if (flag < 84) {
      const b0 = flag - 20;
      const b1 = glyphs.uint8();
      dx = withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4));
      dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
    } else if (flag < 120) {
      const b0 = flag - 84;
      dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + glyphs.uint8());
      dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.uint8());
    } else if (flag < 124) {
      const b0 = glyphs.uint8();
      const b1 = glyphs.uint8();
      dx = withSign(flag, (b0 << 4) + (b1 >> 4));
      dy = withSign(flag >> 1, ((b1 & 0x0f) << 8) + glyphs.uint8());
    } else {
      dx = withSign(flag, glyphs.uint16());
      dy = withSign(flag >> 1, glyphs.uint16());
    }
    x += dx;
    y += dy;
    points.push({ x, y, isOnCurve: (raw & 0x80) === 0 });
  }
  return points;
}

/**
 * Rebuilds a simple glyph from its point counts, flags, coordinate triplets and instructions,
 * and encodes it as TrueType does.
 *
 * @param contourCount - Its contours.
 * @param streams - The streams it reads.
 * @param boxes - The bounding-box stream when the glyph has an explicit box.
 * @param isOverlapping - Whether the glyph's first flag carries OVERLAP_SIMPLE.
 * @returns The glyph's bytes.
 * @throws {FontFormatError} When a stream runs out, the glyph has more than 65,535 points or a
 *   coordinate does not fit in 16 bits.
 */
function simpleGlyph(
  contourCount: number,
  streams: SimpleStreams,
  boxes: ByteReader | undefined,
  isOverlapping: boolean,
): Uint8Array {
  const ends: number[] = [];
  let pointCount = 0;
  for (let contour = 0; contour < contourCount; contour += 1) {
    pointCount += streams.points.uint255();
    if (pointCount > 0xffff) throw new FontFormatError('A WOFF2 glyph has too many points.');
    ends.push(pointCount - 1);
  }
  const points = readPoints(streams.flags.slice(pointCount), streams.glyphs);
  const instructionLength = streams.glyphs.uint255();
  const instructions = streams.instructions.slice(instructionLength);
  const box = boxes === undefined ? boundsOf(points) : readBox(boxes);

  // TrueType's encoding: every flag written out (no repeats), each delta short or long.
  const outFlags: number[] = [];
  const xBytes: number[] = [];
  const yBytes: number[] = [];
  let lastX = 0;
  let lastY = 0;
  points.forEach((point, index) => {
    const deltaX = point.x - lastX;
    const deltaY = point.y - lastY;
    lastX = point.x;
    lastY = point.y;
    let flag = point.isOnCurve ? ON_CURVE : 0;
    if (index === 0 && isOverlapping) flag |= OVERLAP_SIMPLE;
    flag |= encodeDelta(deltaX, X_SHORT, X_SAME_OR_POSITIVE, xBytes);
    flag |= encodeDelta(deltaY, Y_SHORT, Y_SAME_OR_POSITIVE, yBytes);
    outFlags.push(flag);
  });
  const out = new Uint8Array(
    10 + 2 * contourCount + 2 + instructionLength + outFlags.length + xBytes.length + yBytes.length,
  );
  const writer = viewOf(out);
  writer.setInt16(0, contourCount);
  box.forEach((value, index) => {
    writer.setInt16(2 + index * 2, value);
  });
  ends.forEach((end, index) => {
    writer.setUint16(10 + index * 2, end);
  });
  let at = 10 + 2 * contourCount;
  writer.setUint16(at, instructionLength);
  at += 2;
  out.set(instructions, at);
  at += instructionLength;
  out.set(outFlags, at);
  at += outFlags.length;
  out.set(xBytes, at);
  out.set(yBytes, at + xBytes.length);
  return out;
}

/**
 * Appends one delta in TrueType's encoding: none when zero, one byte when short, two otherwise.
 *
 * @param delta - The delta.
 * @param short - The flag for a one-byte delta.
 * @param sameOrPositive - The flag for a zero delta, or a positive one-byte delta.
 * @param bytes - Where its bytes go.
 * @returns The flag bits it sets.
 * @throws {FontFormatError} When the delta does not fit in 16 bits.
 */
function encodeDelta(
  delta: number,
  short: number,
  sameOrPositive: number,
  bytes: number[],
): number {
  if (delta === 0) return sameOrPositive;
  if (delta > -256 && delta < 256) {
    bytes.push(Math.abs(delta));
    return delta > 0 ? short | sameOrPositive : short;
  }
  if (delta < -0x8000 || delta > 0x7fff) {
    throw new FontFormatError('A WOFF2 glyph has a coordinate outside 16 bits.');
  }
  bytes.push((delta >> 8) & 0xff, delta & 0xff);
  return 0;
}

/**
 * The bounds of a glyph's points.
 *
 * @param points - The points.
 * @returns xMin, yMin, xMax and yMax; zeros for a glyph without points.
 */
function boundsOf(points: readonly { readonly x: number; readonly y: number }[]): number[] {
  if (points.length === 0) return [0, 0, 0, 0];
  let [xMin, yMin, xMax, yMax] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of points) {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  }
  return [xMin, yMin, xMax, yMax];
}

/**
 * An explicit bounding box.
 *
 * @param boxes - The bounding-box stream.
 * @returns xMin, yMin, xMax and yMax.
 * @throws {FontFormatError} When the stream runs out.
 */
function readBox(boxes: ByteReader): number[] {
  return [boxes.int16(), boxes.int16(), boxes.int16(), boxes.int16()];
}

/**
 * Rebuilds a composite glyph: its components copied from the composite stream, its instructions
 * (when a component says it has them) from the glyph and instruction streams.
 *
 * @param composites - The composite stream.
 * @param glyphs - The glyph stream (instruction lengths).
 * @param instructions - The instruction stream.
 * @param boxes - The bounding-box stream.
 * @returns The glyph's bytes.
 * @throws {FontFormatError} When a stream runs out.
 */
function compositeGlyph(
  composites: ByteReader,
  glyphs: ByteReader,
  instructions: ByteReader,
  boxes: ByteReader,
): Uint8Array {
  const start = composites.at;
  let hasInstructions = false;
  for (;;) {
    const flags = composites.uint16();
    composites.uint16();
    let argumentBytes = (flags & ARG_1_AND_2_ARE_WORDS) !== 0 ? 4 : 2;
    if ((flags & WE_HAVE_A_SCALE) !== 0) argumentBytes += 2;
    else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) argumentBytes += 4;
    else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) argumentBytes += 8;
    composites.slice(argumentBytes);
    if ((flags & WE_HAVE_INSTRUCTIONS) !== 0) hasInstructions = true;
    if ((flags & MORE_COMPONENTS) === 0) break;
  }
  const componentBytes = composites.since(start);
  const box = readBox(boxes);
  const instructionLength = hasInstructions ? glyphs.uint255() : 0;
  const code = instructions.slice(instructionLength);
  const out = new Uint8Array(
    10 + componentBytes.length + (hasInstructions ? 2 + instructionLength : 0),
  );
  const writer = viewOf(out);
  writer.setInt16(0, -1);
  box.forEach((value, index) => {
    writer.setInt16(2 + index * 2, value);
  });
  out.set(componentBytes, 10);
  if (hasInstructions) {
    writer.setUint16(10 + componentBytes.length, instructionLength);
    out.set(code, 12 + componentBytes.length);
  }
  return out;
}
