/// <reference types="node" />
// The bundled Liberation Sans faces (packages/engine/assets/fonts, where the renderer bundles
// them), read from disk in every test run.
// Tests only: the package's own code reads no files.
import { readFileSync } from 'node:fs';

import type { FontFaceKey } from '../font/font-face.js';

/** The family name of the bundled test font. */
export const BUNDLED_FAMILY = 'Liberation Sans';

const FONT_DIR = new URL('../../../engine/assets/fonts/', import.meta.url);

/**
 * Reads one bundled file into a fresh buffer.
 *
 * @param name - The file name.
 * @returns A copy of its bytes the caller may transfer or detach.
 */
function bytesOf(name: string): ArrayBuffer {
  const file = readFileSync(new URL(name, FONT_DIR));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/** One bundled face: its key and a fresh copy of its file's bytes. */
export interface BundledFace {
  /** The face's family, weight and slant. */
  readonly face: FontFaceKey;
  /** The TrueType file. */
  readonly bytes: ArrayBuffer;
}

/**
 * Loads the four bundled Liberation Sans faces. Each call reads fresh buffers, so a test may
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
    { face: face(400, false), bytes: bytesOf('LiberationSans-Regular.ttf') },
    { face: face(700, false), bytes: bytesOf('LiberationSans-Bold.ttf') },
    { face: face(400, true), bytes: bytesOf('LiberationSans-Italic.ttf') },
    { face: face(700, true), bytes: bytesOf('LiberationSans-BoldItalic.ttf') },
  ];
}

/**
 * Loads the bundled regular face's bytes.
 *
 * @returns A fresh copy of LiberationSans-Regular.ttf.
 */
export function loadRegularFontBytes(): ArrayBuffer {
  return bytesOf('LiberationSans-Regular.ttf');
}
