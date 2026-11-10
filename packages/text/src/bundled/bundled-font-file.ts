import { fontFaceId, type FontFaceKey } from '../font/font-face.js';

import { BUNDLED_FONT_FILES } from './font-files.js';

/** A bundled face and the font file its metrics were generated from. */
export interface BundledFontFile extends FontFaceKey {
  /** The file's path from the repository root, such as `packages/engine/assets/fonts/…`. */
  readonly path: string;
}

let byFace: ReadonlyMap<string, string> | undefined;

/**
 * The font file a bundled face's metrics were generated from, so a measurement can shape with
 * the bytes the app draws with: every face of a bundled family and every symbol coverage face.
 *
 * @param face - The face.
 * @returns Its path from the repository root, or `undefined` for a face not bundled.
 */
export function bundledFontFile(face: FontFaceKey): string | undefined {
  byFace ??= new Map(
    BUNDLED_FONT_FILES.map(([family, weight, isItalic, path]) => [
      fontFaceId({ family, weight, isItalic }),
      path,
    ]),
  );
  return byFace.get(fontFaceId(face));
}

/**
 * Every bundled font file's path from the repository root, each once, in table order: what a
 * server that measures text must deploy.
 *
 * @returns The paths.
 */
export function bundledFontFilePaths(): readonly string[] {
  return [...new Set(BUNDLED_FONT_FILES.map(([, , , path]) => path))];
}
