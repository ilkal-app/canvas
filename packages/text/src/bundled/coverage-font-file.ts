import type { FontWeight } from '@canvas/schema';

import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import { HAN_LANGUAGE_FAMILIES } from '../script/fallback-families.js';
import { SCRIPT_COVERAGE_FAMILIES } from '../symbols/script-coverage.js';

import { COVERAGE_FACE_FILES } from './coverage-font-files.js';

/** The coverage faces' folder, from the repository root. */
const COVERAGE_FONT_FOLDER = 'packages/app/assets/fonts/script-coverage/';

/**
 * The file of each Noto coverage face: family, weight, italic, and the path from the
 * repository root, in catalogue order.
 */
export const COVERAGE_FONT_FILES: readonly (readonly [
  family: string,
  weight: FontWeight,
  isItalic: boolean,
  path: string,
])[] = COVERAGE_FACE_FILES.map(
  ([family, weight, isItalic, file]) =>
    [family, weight, isItalic, `${COVERAGE_FONT_FOLDER}${file}`] as const,
);

let byFace: ReadonlyMap<string, string> | undefined;

/**
 * The font file of a Noto coverage face, so a server can measure script text with the
 * bytes the app draws it with.
 *
 * @param face - The face.
 * @returns Its path from the repository root, or `undefined` for a face not in the coverage
 *   catalogue.
 */
export function coverageFontFile(face: FontFaceKey): string | undefined {
  byFace ??= new Map(
    COVERAGE_FONT_FILES.map(([family, weight, isItalic, path]) => [
      fontFaceId({ family, weight, isItalic }),
      path,
    ]),
  );
  return byFace.get(fontFaceId(face));
}

/** The Han faces (Simplified and Traditional Chinese, Hong Kong, Japanese, Korean). */
const HAN_FAMILIES: ReadonlySet<string> = new Set(HAN_LANGUAGE_FAMILIES);

/**
 * The script faces a server deploys and measures with: every one but the Han faces,
 * which are about 71 MB together and stay out of the server images (the 2026-10-17 decision on
 *). Han text is measured as before until they have a source of their own.
 *
 * @returns The families, in `SCRIPT_COVERAGE_FAMILIES` order.
 */
export function serverCoverageFamilies(): readonly string[] {
  return SCRIPT_COVERAGE_FAMILIES.filter((family) => !HAN_FAMILIES.has(family));
}

/**
 * The font files of the script faces a server deploys ({@link serverCoverageFamilies}), each
 * once, in table order.
 *
 * @returns Their paths from the repository root.
 */
export function serverCoverageFontFilePaths(): readonly string[] {
  const families = new Set(serverCoverageFamilies());
  return COVERAGE_FONT_FILES.filter(([family]) => families.has(family)).map(([, , , path]) => path);
}
