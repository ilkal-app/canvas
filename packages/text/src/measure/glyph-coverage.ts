import type { StyleRun } from '@canvas/schema';

import { fontFaceId, fontFaceOf, resolveFontFace } from '../font/font-face.js';
import type { FontMetrics } from '../font/font-metrics.js';
import { codepointAt } from '../layout/codepoints.js';
import { isCoverageFamily } from '../symbols/coverage-family.js';

import { clusterFaces, fallbackRuns, isUndrawn, type FallbackFace } from './fallback-runs.js';

/** A character no available face can draw, at its place in the text. */
export interface MissingGlyph {
  /** The character's Unicode code point. */
  readonly codePoint: number;
  /** Where it starts in the text, UTF-16 code units (as style run lengths count). */
  readonly index: number;
}

/** Each face's covered code points, built once per metrics object. */
const coverage = new WeakMap<FontMetrics, ReadonlySet<number>>();

/**
 * Whether a face maps a character.
 *
 * @param font - The face's metrics.
 * @param codePoint - The character.
 * @returns True when it has a glyph for it.
 */
function covers(font: FontMetrics, codePoint: number): boolean {
  let codePoints = coverage.get(font);
  if (codePoints === undefined) {
    codePoints = new Set(font.advances.map(([listed]) => listed));
    coverage.set(font, codePoints);
  }
  return codePoints.has(codePoint);
}

/**
 * The fonts' faces by id, and the coverage faces (the Noto faces, as the engine's `coverageRuns`
 * falls back to them) in order.
 *
 * @param fonts - The faces' metrics.
 * @returns Both.
 */
function facesOf(fonts: readonly FontMetrics[]): {
  readonly byId: ReadonlyMap<string, FontMetrics>;
  readonly fallbacks: readonly FontMetrics[];
} {
  return {
    byId: new Map(fonts.map((font) => [fontFaceId(font.face), font])),
    fallbacks: fonts.filter((font) => isCoverageFamily(font.face.family)),
  };
}

/**
 * The face a run's style resolves to among the fonts, as layout resolves it.
 *
 * @param run - The run.
 * @param fonts - The faces' metrics.
 * @param byId - The same, by face id.
 * @returns The face, or `undefined` when there are none.
 */
function runFace(
  run: StyleRun,
  fonts: readonly FontMetrics[],
  byId: ReadonlyMap<string, FontMetrics>,
): FontMetrics | undefined {
  const face = resolveFontFace(
    fonts.map((font) => font.face),
    fontFaceOf(run.style),
  );
  return face === undefined ? undefined : byId.get(fontFaceId(face));
}

/** Each face's metrics as fallback sees them, built once per metrics object. */
const fallbackFaces = new WeakMap<FontMetrics, FallbackFace>();

/**
 * A face's metrics as a fallback face: it maps exactly the codepoints it has advances for.
 *
 * @param font - The face's metrics.
 * @returns The fallback face, the same object each time.
 */
function fallbackFaceOf(font: FontMetrics): FallbackFace {
  let face = fallbackFaces.get(font);
  if (face === undefined) {
    const { family, weight, isItalic, postScriptName } = font.face;
    // A named face keeps its name.
    const name = postScriptName === undefined ? {} : { postScriptName };
    face = { family, weight, isItalic, ...name, covers: (codePoint) => covers(font, codePoint) };
    fallbackFaces.set(font, face);
  }
  return face;
}

/**
 * The fallback chooser's view of the fonts: each run's own face, and the coverage faces.
 *
 * @param fonts - The faces' metrics.
 * @returns The run's face lookup and the candidates.
 */
function fallbackView(fonts: readonly FontMetrics[]): {
  readonly faceOf: (run: StyleRun) => FallbackFace | undefined;
  readonly candidates: readonly FallbackFace[];
} {
  const { byId, fallbacks } = facesOf(fonts);
  return {
    faceOf: (run) => {
      const own = runFace(run, fonts, byId);
      return own === undefined ? undefined : fallbackFaceOf(own);
    },
    candidates: fallbacks.map(fallbackFaceOf),
  };
}

/**
 * Splits runs so each grapheme cluster a run's face cannot draw whole is set in the coverage face
 * that can ('s `fallbackRuns`), exactly as the engine lays text out (`coverageRuns`): the
 * stored runs are not changed, only the runs measured. Pure.
 *
 * @param text - The text.
 * @param runs - Its stored runs; not mutated.
 * @param fonts - The faces' metrics, coverage faces included (`measuringFontsFor`).
 * @returns The runs to lay out.
 */
export function coverageMeasureRuns(
  text: string,
  runs: readonly StyleRun[],
  fonts: readonly FontMetrics[],
): readonly StyleRun[] {
  const { faceOf, candidates } = fallbackView(fonts);
  return fallbackRuns(text, runs, faceOf, candidates);
}

/**
 * The characters of a text that no available face can draw: in each grapheme cluster,
 * the drawn characters the face chosen for it (`fallbackRuns`) lacks, which draw as the missing
 * glyph. Tabs, line breaks, joiners and variation selectors draw nothing and are never reported.
 * Pure.
 *
 * @param text - The text.
 * @param runs - Its runs.
 * @param fonts - The faces' metrics, coverage faces included (`measuringFontsFor`).
 * @returns Each such character with its index, in text order.
 */
export function missingGlyphs(
  text: string,
  runs: readonly StyleRun[],
  fonts: readonly FontMetrics[],
): readonly MissingGlyph[] {
  const { faceOf, candidates } = fallbackView(fonts);
  return missingClusterGlyphs(text, runs, faceOf, candidates);
}

/**
 * The characters of a text that no face can draw, over any faces (the render page's
 * loaded faces too): in each grapheme cluster, the drawn characters the face `fallbackRuns`
 * chooses for it lacks. Pure.
 *
 * @param text - The text.
 * @param runs - Its runs.
 * @param faceOf - The face a run's style resolves to, or `undefined`.
 * @param candidates - The fallback faces, in load order.
 * @returns Each such character with its index, in text order.
 */
export function missingClusterGlyphs(
  text: string,
  runs: readonly StyleRun[],
  faceOf: (run: StyleRun) => FallbackFace | undefined,
  candidates: readonly FallbackFace[],
): readonly MissingGlyph[] {
  const missing: MissingGlyph[] = [];
  for (const clusters of clusterFaces(text, runs, faceOf, candidates)) {
    for (const { start, end, face } of clusters) {
      for (let index = start; index < end;) {
        const { codepoint, length } = codepointAt(text, index);
        if (!isUndrawn(codepoint) && face?.covers(codepoint) !== true) {
          missing.push({ codePoint: codepoint, index });
        }
        index += length;
      }
    }
  }
  return missing;
}
