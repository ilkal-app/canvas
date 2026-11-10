import { gifRowOrder, parseGif, type GifFile, type GifFrameRecord } from './gif-file.js';
import { decodeGifLzw } from './gif-lzw.js';
import { levelSize, type Size } from './level-selection.js';

/**
 * The shortest delay a frame is shown for as stored, ms: browsers show a frame whose delay is
 * 10 ms or less (0 or 1 hundredth) for 100 ms, so such files do not spin.
 */
const MIN_HONOURED_DELAY_MS = 20;

/** What a frame shows for in place of a delay under {@link MIN_HONOURED_DELAY_MS}, ms. */
const SHORT_DELAY_MS = 100;

/**
 * The most canvas pixels a GIF's frames may compose together (frames × width × height) before
 * `decodeGifFrames` refuses to animate it: about a thousand 512 × 512 frames.
 */
export const MAX_GIF_COMPOSE_PIXELS = 2 ** 28;

/** One decoded frame: premultiplied RGBA at the decode size, and how long it shows. */
export interface AnimationFrame {
  /** RGBA, 8 bits per channel, premultiplied alpha, rows top to bottom. */
  readonly rgba: Uint8Array;
  /** How long it shows, ms (`gifFrameDurationMs`). */
  readonly durationMs: number;
}

/** A GIF decoded to its frames (`decodeGifFrames`). */
export interface AnimationFrames {
  /** Every frame's width, px. */
  readonly widthPx: number;
  /** Every frame's height, px. */
  readonly heightPx: number;
  /** The frames, in order. */
  readonly frames: readonly AnimationFrame[];
  /** How many times the frames play: a whole number, or `Infinity` to loop forever. */
  readonly plays: number;
}

/** How large `decodeGifFrames` may make the frames. */
export interface AnimationDecodeLimits {
  /** The longest edge a frame may have, px. */
  readonly maxLongEdgePx: number;
  /** The most bytes all frames may take together. */
  readonly maxBytes: number;
}

/**
 * How long a GIF frame shows, as browsers time it: its delay, or 100 ms when the delay is 10 ms
 * or less. Pure.
 *
 * @param delayMs - The stored delay, ms.
 * @returns The duration, ms.
 */
export function gifFrameDurationMs(delayMs: number): number {
  return delayMs < MIN_HONOURED_DELAY_MS ? SHORT_DELAY_MS : delayMs;
}

/**
 * How many times a GIF plays, from its NETSCAPE2.0 loop count as browsers read it: once without
 * one, forever for 0, n + 1 times for n. Pure.
 *
 * @param loopCount - The stored loop count, if any.
 * @returns The plays, or `Infinity`.
 */
export function gifPlays(loopCount: number | undefined): number {
  if (loopCount === undefined) return 1;
  return loopCount === 0 ? Infinity : loopCount + 1;
}

/**
 * The size the frames are decoded at: the canvas, scaled down so the long edge and the bytes of
 * every frame fit the limits (never up). Pure.
 *
 * @param canvas - The GIF's canvas, px.
 * @param frameCount - Its number of frames.
 * @param limits - The limits.
 * @returns The size, px.
 */
export function animationDecodeSize(
  canvas: Size,
  frameCount: number,
  limits: AnimationDecodeLimits,
): Size {
  const longEdge = Math.max(canvas.width, canvas.height);
  const byteScale = Math.sqrt(limits.maxBytes / (frameCount * canvas.width * canvas.height * 4));
  const scale = Math.min(1, limits.maxLongEdgePx / longEdge, byteScale);
  if (scale >= 1) return { width: canvas.width, height: canvas.height };
  return levelSize(canvas, Math.max(1, Math.floor(longEdge * scale)));
}

/**
 * Draws a frame's opaque pixels onto the canvas, clipped to it.
 *
 * @param canvas - The canvas, straight RGBA; changed.
 * @param size - The canvas size, px.
 * @param frame - The frame.
 */
function drawFrame(canvas: Uint8Array, size: Size, frame: GifFrameRecord): void {
  const { left, top, width, height, palette, transparentIndex } = frame;
  const indices = decodeGifLzw(frame.minCodeSize, frame.data, width * height);
  const rows = gifRowOrder(height, frame.isInterlaced);
  const colours = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  const pixels = new DataView(indices.buffer, indices.byteOffset, indices.byteLength);
  rows.forEach((row, stored) => {
    const y = top + row;
    if (y >= size.height) return;
    for (let column = 0; column < width; column += 1) {
      const x = left + column;
      if (x >= size.width) break;
      const index = pixels.getUint8(stored * width + column);
      if (index === transparentIndex || index * 3 + 2 >= palette.length) continue;
      const at = (y * size.width + x) * 4;
      canvas[at] = colours.getUint8(index * 3);
      canvas[at + 1] = colours.getUint8(index * 3 + 1);
      canvas[at + 2] = colours.getUint8(index * 3 + 2);
      canvas[at + 3] = 255;
    }
  });
}

/**
 * Clears a frame's rectangle to transparent (disposal 2: browsers clear to transparent, not to
 * the background colour).
 *
 * @param canvas - The canvas; changed.
 * @param size - The canvas size, px.
 * @param frame - The frame.
 */
function clearFrame(canvas: Uint8Array, size: Size, frame: GifFrameRecord): void {
  const right = Math.min(size.width, frame.left + frame.width);
  const bottom = Math.min(size.height, frame.top + frame.height);
  for (let y = frame.top; y < bottom; y += 1) {
    if (frame.left < right)
      canvas.fill(0, (y * size.width + frame.left) * 4, (y * size.width + right) * 4);
  }
}

/**
 * Box-filters straight RGBA down to a size, premultiplying as it averages (levels are
 * premultiplied, so filtering never blends a transparent pixel's colour in).
 * The same size only premultiplies. Pure.
 *
 * @param source - Straight RGBA.
 * @param from - Its size, px.
 * @param to - The output size, px, at most `from` on each side.
 * @returns Premultiplied RGBA at `to`.
 */
export function downscalePremultiplied(source: Uint8Array, from: Size, to: Size): Uint8Array {
  const out = new Uint8Array(to.width * to.height * 4);
  const pixels = new DataView(source.buffer, source.byteOffset, source.byteLength);
  for (let y = 0; y < to.height; y += 1) {
    const y0 = Math.floor((y * from.height) / to.height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * from.height) / to.height));
    for (let x = 0; x < to.width; x += 1) {
      const x0 = Math.floor((x * from.width) / to.width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * from.width) / to.width));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * from.width + sx) * 4;
          const a = pixels.getUint8(at + 3);
          red += pixels.getUint8(at) * a;
          green += pixels.getUint8(at + 1) * a;
          blue += pixels.getUint8(at + 2) * a;
          alpha += a;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const at = (y * to.width + x) * 4;
      out[at] = Math.round(red / 255 / count);
      out[at + 1] = Math.round(green / 255 / count);
      out[at + 2] = Math.round(blue / 255 / count);
      out[at + 3] = Math.round(alpha / count);
    }
  }
  return out;
}

/**
 * Composes every frame of a parsed GIF on its canvas, in order, honouring each frame's
 * transparency and disposal (0 and 1 keep it, 2 clears its rectangle to transparent, 3 restores
 * what was under it), and hands each composed canvas to `onFrame`. Pure apart from the callback.
 *
 * @param file - The parsed GIF.
 * @param onFrame - Receives each composed canvas (straight RGBA, reused: copy what you keep) and
 *   its frame.
 * @throws {RangeError} When a frame's LZW data is malformed.
 */
export function composeGifFrames(
  file: GifFile,
  onFrame: (canvas: Uint8Array, frame: GifFrameRecord) => void,
): void {
  const size = { width: file.widthPx, height: file.heightPx };
  const canvas = new Uint8Array(size.width * size.height * 4);
  for (const frame of file.frames) {
    const saved = frame.disposal === 3 ? canvas.slice() : undefined;
    drawFrame(canvas, size, frame);
    onFrame(canvas, frame);
    if (frame.disposal === 2) clearFrame(canvas, size, frame);
    if (saved !== undefined) canvas.set(saved);
  }
}

/**
 * Decodes a GIF to its frames for playback: each frame composed
 * on the canvas as browsers compose it, scaled down to fit the limits (`animationDecodeSize`),
 * premultiplied, with its duration (`gifFrameDurationMs`) and the number of plays (`gifPlays`).
 * Runs in a job worker (`frames` jobs), never on the thread that renders. Pure.
 *
 * @param bytes - The GIF file.
 * @param limits - The largest frames and the most bytes they may take.
 * @returns The frames.
 * @throws {RangeError} When the file is not a GIF, is malformed, or has more frames or pixels to
 *   compose than playback takes (`MAX_GIF_FRAMES`, {@link MAX_GIF_COMPOSE_PIXELS}).
 */
export function decodeGifFrames(bytes: Uint8Array, limits: AnimationDecodeLimits): AnimationFrames {
  const file = parseGif(bytes);
  const canvas = { width: file.widthPx, height: file.heightPx };
  if (file.frames.length * canvas.width * canvas.height > MAX_GIF_COMPOSE_PIXELS) {
    throw new RangeError('The GIF has too many pixels to animate.');
  }
  const size = animationDecodeSize(canvas, file.frames.length, limits);
  const frames: AnimationFrame[] = [];
  composeGifFrames(file, (composed, frame) => {
    frames.push({
      rgba: downscalePremultiplied(composed, canvas, size),
      durationMs: gifFrameDurationMs(frame.delayMs),
    });
  });
  return { widthPx: size.width, heightPx: size.height, frames, plays: gifPlays(file.loopCount) };
}
