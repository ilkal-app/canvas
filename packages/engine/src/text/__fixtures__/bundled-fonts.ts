// The bundled Liberation Sans faces (packages/engine/assets/fonts), loaded the same way in every
// test run: Vite inlines each file as a base64 data URL, decoded here into bytes (rendering
// tests bundle their own fonts).
import type { FontFaceKey } from '@canvas/text';

import boldUrl from '../../../assets/fonts/LiberationSans-Bold.ttf?inline';
import boldItalicUrl from '../../../assets/fonts/LiberationSans-BoldItalic.ttf?inline';
import italicUrl from '../../../assets/fonts/LiberationSans-Italic.ttf?inline';
import regularUrl from '../../../assets/fonts/LiberationSans-Regular.ttf?inline';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The family name of the bundled test font. */
export const BUNDLED_FAMILY = 'Liberation Sans';

const SEXTETS = new Uint8Array(128);
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
  SEXTETS[BASE64_ALPHABET.charCodeAt(index)] = index;
}

function decodeBase64(base64: string): ArrayBuffer {
  const clean = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let bitCount = 0;
  let byteIndex = 0;
  for (let index = 0; index < clean.length; index += 1) {
    bits = ((bits << 6) | (SEXTETS[clean.charCodeAt(index)] ?? 0)) & 0xffffff;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[byteIndex] = (bits >> bitCount) & 0xff;
      byteIndex += 1;
    }
  }
  return bytes.buffer;
}

function bytesOf(dataUrl: string): ArrayBuffer {
  return decodeBase64(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

/** One bundled face: its key and a fresh copy of its file's bytes. */
export interface BundledFace {
  /** The face's family, weight and slant. */
  readonly face: FontFaceKey;
  /** The TrueType file. */
  readonly bytes: ArrayBuffer;
}

/**
 * Loads the four bundled Liberation Sans faces. Each call decodes fresh buffers, so a test may
 * transfer or detach them.
 *
 * @returns Regular, bold, italic and bold italic, in that order.
 */
export function loadBundledFaces(): BundledFace[] {
  const face = (weight: 400 | 700, isItalic: boolean): FontFaceKey => ({
    family: BUNDLED_FAMILY,
    weight,
    isItalic,
  });
  return [
    { face: face(400, false), bytes: bytesOf(regularUrl) },
    { face: face(700, false), bytes: bytesOf(boldUrl) },
    { face: face(400, true), bytes: bytesOf(italicUrl) },
    { face: face(700, true), bytes: bytesOf(boldItalicUrl) },
  ];
}

/**
 * Loads the bundled regular face's bytes.
 *
 * @returns A fresh copy of LiberationSans-Regular.ttf.
 */
export function loadRegularFontBytes(): ArrayBuffer {
  return bytesOf(regularUrl);
}
