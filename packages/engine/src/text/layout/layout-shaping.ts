import { createShapingMeasurer, fontFaceId, type GlyphMeasurer, type Shaper } from '@canvas/text';

import type { FontLibrary } from '../font/font-library.js';

import type { LayoutJobRequest } from './layout-job-payload.js';

/**
 * What a layout shapes with: the loaded shaper, and the faces' font files by their
 * `fontKey`, the key a `layout` job's faces name.
 */
export interface LayoutShaping {
  /** The loaded shaper (`loadShaper`). */
  readonly shaper: Shaper;
  /**
   * A face's font file.
   *
   * @param fontKey - The face's `LoadedFontFace.fontKey`.
   * @returns Its bytes, or `undefined` when there are none under the key.
   */
  bytesOf(fontKey: string): Uint8Array | undefined;
}

/**
 * Shaping over a font library: the bytes of the face loaded under each key now, so a face
 * replaced since a request was made has no bytes under the old key and the request is laid out
 * per codepoint rather than shaped with the wrong file.
 *
 * @param library - The loaded faces.
 * @param shaper - The loaded shaper.
 * @returns The shaping.
 */
export function libraryShaping(library: FontLibrary, shaper: Shaper): LayoutShaping {
  return {
    shaper,
    bytesOf: (fontKey) => {
      for (const face of library.faces) {
        const loaded = library.get(fontFaceId(face));
        if (loaded?.fontKey === fontKey) return new Uint8Array(loaded.jobResource.bytes);
      }
      return undefined;
    },
  };
}

/**
 * The shaping measurer of a layout request, when every face it uses has a font file.
 *
 * @param request - The request.
 * @param shaping - The shaper and the files.
 * @returns The measurer, or `undefined` when a face has no file (the request is then laid out
 *   with per-codepoint metrics).
 */
export function shapingMeasurerOf(
  request: LayoutJobRequest,
  shaping: LayoutShaping,
): GlyphMeasurer | undefined {
  const fonts = [];
  for (const [index, metrics] of request.fonts.entries()) {
    const fontKey = request.faces[index]?.fontKey;
    const bytes = fontKey === undefined ? undefined : shaping.bytesOf(fontKey);
    if (fontKey === undefined || bytes === undefined) return undefined;
    fonts.push({ metrics, bytes, shapingId: fontKey });
  }
  return createShapingMeasurer(shaping.shaper, fonts);
}
