import { gifRowOrder } from './gif-file.js';
import type { Size } from './level-selection.js';

/** A frame's rectangle on a GIF's canvas, px. */
export interface FixtureGifRect {
  /** Its left edge, px. */
  readonly left: number;
  /** Its top edge, px. */
  readonly top: number;
  /** Its width, px. */
  readonly width: number;
  /** Its height, px. */
  readonly height: number;
}

/** One frame of a {@link FixtureGifSpec}. */
export interface FixtureGifFrame {
  /** Its delay, in hundredths of a second, as the file stores it (default 10: 100 ms). */
  readonly delayCs?: number;
  /** Its disposal method (GIF89a): 0 or 1 keep it, 2 clears its rectangle, 3 restores. */
  readonly disposal?: number;
  /** The palette index drawn transparent, if any. */
  readonly transparentIndex?: number;
  /** Its rectangle on the canvas, px; default the whole canvas. */
  readonly rect?: FixtureGifRect;
  /** Its colour indices, row by row: one index for every pixel, or one array of them. */
  readonly indices: number | Uint8Array;
  /** Whether its rows are stored interlaced (four passes). */
  readonly isInterlaced?: boolean;
}

/** A GIF for tests, golden scenes and benchmarks (`encodeFixtureGif`). */
export interface FixtureGifSpec {
  /** The logical screen's width, px. */
  readonly widthPx: number;
  /** The logical screen's height, px. */
  readonly heightPx: number;
  /** The global colour table, 8-bit RGB, at most 256 colours. */
  readonly palette: readonly (readonly [number, number, number])[];
  /** The frames, in order. */
  readonly frames: readonly FixtureGifFrame[];
  /**
   * The NETSCAPE2.0 loop count: 0 loops forever, n plays n + 1 times; absent writes no loop
   * extension, so the animation plays once.
   */
  readonly loopCount?: number;
}

/** A byte list built from small writes and whole arrays. */
class ByteSink {
  private readonly parts: Uint8Array[] = [];
  private small: number[] = [];

  byte(value: number): void {
    this.small.push(value & 0xff);
  }

  word(value: number): void {
    this.byte(value);
    this.byte(value >> 8);
  }

  text(value: string): void {
    for (const character of value) this.byte(character.charCodeAt(0));
  }

  /**
   * Writes data as sub-blocks of at most 255 bytes, then the terminator.
   *
   * @param data - The data.
   */
  blocks(data: Uint8Array): void {
    this.flush();
    const blocks = Math.ceil(data.length / 255);
    const out = new Uint8Array(data.length + blocks + 1);
    let at = 0;
    for (let offset = 0; offset < data.length; offset += 255) {
      const chunk = data.subarray(offset, offset + 255);
      out[at] = chunk.length;
      out.set(chunk, at + 1);
      at += chunk.length + 1;
    }
    this.parts.push(out);
  }

  /**
   * Everything written, in order.
   *
   * @returns The bytes.
   */
  finish(): ArrayBuffer {
    this.flush();
    const total = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out.buffer;
  }

  private flush(): void {
    this.parts.push(Uint8Array.from(this.small));
    this.small = [];
  }
}

/**
 * LZW data that never grows its code size: a clear code before every run of literals short
 * enough that the decoder's table stays below the next code size. Valid for every decoder, and
 * simple, if about as large as the pixels themselves.
 *
 * @param indices - The colour indices, in storage order.
 * @param minCodeSize - The minimum code size, bits.
 * @returns The packed bytes.
 */
function literalLzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const codeSize = minCodeSize + 1;
  const run = clear - 2;
  const codes = indices.length + Math.ceil(indices.length / run) + 2;
  const out = new Uint8Array(Math.ceil((codes * codeSize) / 8) + 1);
  let length = 0;
  let bits = 0;
  let bitCount = 0;
  const put = (code: number): void => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out[length] = bits & 0xff;
      length += 1;
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  for (const [offset, index] of indices.entries()) {
    if (offset % run === 0) put(clear);
    put(index);
  }
  if (indices.length === 0) put(clear);
  put(clear + 1);
  if (bitCount > 0) {
    out[length] = bits & 0xff;
    length += 1;
  }
  return out.subarray(0, length);
}

/**
 * The colour indices of a frame in storage order.
 *
 * @param frame - The frame.
 * @param width - Its width, px.
 * @param height - Its height, px.
 * @returns The indices.
 */
function storedIndices(frame: FixtureGifFrame, width: number, height: number): Uint8Array {
  const { indices } = frame;
  if (typeof indices === 'number') return new Uint8Array(width * height).fill(indices);
  const out = new Uint8Array(width * height);
  gifRowOrder(height, frame.isInterlaced === true).forEach((row, stored) => {
    out.set(indices.subarray(row * width, (row + 1) * width), stored * width);
  });
  return out;
}

/**
 * Encodes a GIF89a file from a palette and frames of colour indices (GIF89a: header, logical
 * screen with a global colour table, an optional NETSCAPE2.0 loop extension, then per frame a
 * graphic control extension and an image). Pure and deterministic: the same spec gives the same
 * bytes. Used to make the animated GIFs of tests, golden scenes and benchmarks.
 *
 * @param spec - The screen, palette, frames and loop count.
 * @returns The file.
 * @throws {RangeError} When the palette is empty or holds more than 256 colours.
 */
export function encodeFixtureGif(spec: FixtureGifSpec): ArrayBuffer {
  const colours = spec.palette.length;
  if (colours === 0 || colours > 256) {
    throw new RangeError(`A GIF palette holds 1 to 256 colours; received ${String(colours)}.`);
  }
  const tableBits = Math.max(1, Math.ceil(Math.log2(colours)));
  const sink = new ByteSink();
  sink.text('GIF89a');
  sink.word(spec.widthPx);
  sink.word(spec.heightPx);
  sink.byte(0x80 | (tableBits - 1));
  sink.byte(0);
  sink.byte(0);
  for (let index = 0; index < 1 << tableBits; index += 1) {
    const [red, green, blue] = spec.palette[index] ?? [0, 0, 0];
    sink.byte(red);
    sink.byte(green);
    sink.byte(blue);
  }
  if (spec.loopCount !== undefined) {
    for (const value of [0x21, 0xff, 11]) sink.byte(value);
    sink.text('NETSCAPE2.0');
    sink.byte(3);
    sink.byte(1);
    sink.word(spec.loopCount);
    sink.byte(0);
  }
  const minCodeSize = Math.max(2, tableBits);
  for (const frame of spec.frames) {
    const rect = frame.rect ?? { left: 0, top: 0, width: spec.widthPx, height: spec.heightPx };
    const hasTransparency = frame.transparentIndex !== undefined;
    for (const value of [0x21, 0xf9, 4]) sink.byte(value);
    sink.byte(((frame.disposal ?? 0) << 2) | (hasTransparency ? 1 : 0));
    sink.word(frame.delayCs ?? 10);
    sink.byte(frame.transparentIndex ?? 0);
    sink.byte(0);
    sink.byte(0x2c);
    sink.word(rect.left);
    sink.word(rect.top);
    sink.word(rect.width);
    sink.word(rect.height);
    sink.byte(frame.isInterlaced === true ? 0x40 : 0);
    sink.byte(minCodeSize);
    sink.blocks(literalLzw(storedIndices(frame, rect.width, rect.height), minCodeSize));
  }
  sink.byte(0x3b);
  return sink.finish();
}

/**
 * The colour of each frame of a fixture animation (`encodeFixtureAnimation`), in turn: frame n
 * is entry n modulo the length, solid over the whole image. Golden scenes sample them to prove
 * which frame a frame drew.
 */
export const FIXTURE_GIF_FRAME_COLORS: readonly (readonly [number, number, number])[] = [
  [230, 60, 40],
  [40, 180, 80],
  [40, 90, 230],
  [240, 200, 30],
  [190, 50, 200],
  [30, 190, 200],
  [250, 130, 30],
  [110, 70, 40],
];

/** How a fixture asset animates: an animated GIF of solid frames. */
export interface FixtureAnimationSpec {
  /** Each frame's delay, hundredths of a second: as many frames as entries. */
  readonly delaysCs: readonly number[];
  /** The NETSCAPE2.0 loop count (0 loops forever); absent plays once. Default 0. */
  readonly loopCount?: number | undefined;
}

/**
 * The prefix of fixture asset ids that are animated GIFs when the fixture source does not list
 * them (`createFixtureAssetSource`): the app's harness builds serve every asset id, so a
 * benchmark board names its GIFs this way.
 */
export const ANIMATED_FIXTURE_PREFIX = 'animated-gif-';

/** An animated fixture asset: its size and how it animates. */
export interface FixtureAnimatedAsset {
  /** The GIF's size, px. */
  readonly naturalSize: Size;
  /** Its frames' delays and its loop count. */
  readonly animation: FixtureAnimationSpec;
}

/**
 * The made-up animated GIF every unlisted `animated-gif-…` fixture asset is: 480 × 360 px,
 * twelve frames of 100 ms, looping forever.
 */
export const ANIMATED_FIXTURE_SPEC: FixtureAnimatedAsset = {
  naturalSize: { width: 480, height: 360 },
  animation: { delaysCs: Array.from({ length: 12 }, () => 10), loopCount: 0 },
};

/**
 * A fixture animation as a GIF file: frame n solid in `FIXTURE_GIF_FRAME_COLORS[n mod 8]` over
 * the whole size, with the spec's delays and loop count. `frameCount` keeps only the first
 * frames: one makes the still GIF of its first frame that serves as a server level.
 *
 * @param size - The image's size, px.
 * @param animation - The delays and loop count.
 * @param frameCount - How many frames to keep; all by default.
 * @returns The GIF file.
 */
export function encodeFixtureAnimation(
  size: Size,
  animation: FixtureAnimationSpec,
  frameCount = animation.delaysCs.length,
): ArrayBuffer {
  const colours = FIXTURE_GIF_FRAME_COLORS.length;
  return encodeFixtureGif({
    widthPx: size.width,
    heightPx: size.height,
    palette: FIXTURE_GIF_FRAME_COLORS,
    loopCount: animation.loopCount ?? 0,
    frames: animation.delaysCs
      .slice(0, frameCount)
      .map((delayCs, index) => ({ indices: index % colours, delayCs })),
  });
}
