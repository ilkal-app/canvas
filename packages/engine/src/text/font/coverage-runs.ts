import type { StyleRun } from '@canvas/schema';
import {
  fallbackRuns,
  fontFaceOf,
  isCoverageFamily,
  missingClusterGlyphs,
  type FallbackFace,
  type MissingGlyph,
} from '@canvas/text';

import type { FontLibrary, LoadedFontFace } from './font-library.js';

/** Each loaded face as fallback sees it, built once per loaded face. */
const fallbackFaces = new WeakMap<LoadedFontFace, FallbackFace>();

/**
 * A loaded face as a fallback face: it maps the codepoints its cmap gives a glyph.
 *
 * @param loaded - The loaded face.
 * @returns The fallback face, the same object each time.
 */
function fallbackFaceOf(loaded: LoadedFontFace): FallbackFace {
  let face = fallbackFaces.get(loaded);
  if (face === undefined) {
    const { family, weight, isItalic, postScriptName } = loaded.face;
    face = {
      family,
      weight,
      isItalic,
      // A named face's name rides along, so the layout run draws that face.
      ...(postScriptName === undefined ? {} : { postScriptName }),
      covers: (codepoint) => loaded.font.glyphIdOf(codepoint) !== 0,
    };
    fallbackFaces.set(loaded, face);
  }
  return face;
}

/**
 * The fallback chooser's view of a library: each run's own face, and the loaded coverage faces.
 *
 * @param library - Loaded faces, including on-demand coverage fonts.
 * @returns The run's face lookup and the candidates.
 */
function fallbackView(library: FontLibrary): {
  readonly faceOf: (run: StyleRun) => FallbackFace | undefined;
  readonly candidates: readonly FallbackFace[];
} {
  const candidates = library.faces
    .filter((face) => isCoverageFamily(face.family))
    .map((face) => library.resolve(face))
    .filter((face): face is LoadedFontFace => face !== undefined)
    .map(fallbackFaceOf);
  return {
    faceOf: (run) => {
      const own = library.resolve(fontFaceOf(run.style));
      return own === undefined ? undefined : fallbackFaceOf(own);
    },
    candidates,
  };
}

/**
 * Sets each grapheme cluster a run's face cannot draw whole in a loaded coverage face that can
 * (`fallbackRuns`), without changing stored text runs.
 *
 * @param text - The original text.
 * @param runs - Stored runs, never mutated.
 * @param library - Loaded faces, including on-demand coverage fonts.
 * @returns Layout-only runs, cut only at grapheme cluster boundaries.
 */
export function coverageRuns(
  text: string,
  runs: readonly StyleRun[],
  library: FontLibrary,
): readonly StyleRun[] {
  const { faceOf, candidates } = fallbackView(library);
  return fallbackRuns(text, runs, faceOf, candidates);
}

/**
 * The characters of a text no loaded face can draw, as `coverageRuns` sets it: in each
 * grapheme cluster, the drawn characters the face chosen for it lacks, which draw as the missing
 * glyph.
 *
 * @param text - The text.
 * @param runs - Its runs.
 * @param library - Loaded faces, including on-demand coverage fonts.
 * @returns Each such character with its UTF-16 index, in text order.
 */
export function missingCoverageGlyphs(
  text: string,
  runs: readonly StyleRun[],
  library: FontLibrary,
): readonly MissingGlyph[] {
  const { faceOf, candidates } = fallbackView(library);
  return missingClusterGlyphs(text, runs, faceOf, candidates);
}
