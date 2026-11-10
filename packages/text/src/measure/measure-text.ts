import type { FontWeight, ParagraphStyle, StyleRun } from '@canvas/schema';

import { bundledFamilyMetrics, DEFAULT_FONT_FAMILY } from '../bundled/bundled-fonts.js';
import { COVERAGE_FONT_FILES } from '../bundled/coverage-font-file.js';
import { symbolCoverageMetrics } from '../bundled/coverage-fonts.js';
import { fallbackFamily } from '../font/fallback-family.js';
import { fontFaceId, fontFaceOf, resolveFontFace, type FontFaceKey } from '../font/font-face.js';
import { createFontMetrics, type FontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { createMetricsMeasurer, type GlyphMeasurer } from '../layout/glyph-measurer.js';
import { layoutText } from '../layout/layout-text.js';
import type { TextAlign, TextBaseDirection } from '../layout/text-layout.js';
import { elementAt } from '../line-break/element-at.js';
import { scriptCoverageFamilies } from '../symbols/script-coverage.js';

import { coverageMeasureRuns } from './glyph-coverage.js';
import type { SyncFontBytesSource } from './text-shaping.js';

/** A family a text names that the app does not bundle, and the family it is measured in. */
export interface UnknownFamily {
  /** The family the text names. */
  readonly family: string;
  /**
   * The bundled family it is measured in: the one the app loads in its place
   * (`fallbackFamily`), as a page without the named font draws it.
   */
  readonly measuredWith: string;
}

/** A weight a bundled family lacks, and the weight of the nearest face that draws it. */
export interface WeightFallback {
  /** The family. */
  readonly family: string;
  /** The weight the text asks for. */
  readonly weight: FontWeight;
  /** Whether it asks for the italic face. */
  readonly isItalic: boolean;
  /** The weight of the face it is drawn and measured with. */
  readonly drawnWeight: FontWeight;
}

/** The fonts a text is measured with: bundled faces' metrics, and the families not bundled. */
export interface MeasuringFonts {
  /**
   * The metrics of every face the text may use, the default family's first, then the symbol
   * faces a character its own font lacks falls back to.
   */
  readonly fonts: readonly FontMetrics[];
  /** Families the runs name that are not bundled, each once, in the order first named. */
  readonly unknownFamilies: readonly UnknownFamily[];
  /**
   * Weights a bundled family the runs name lacks, each family, weight and slant once, in the order
   * first named, with the weight drawn in its place.
   */
  readonly weightFallbacks: readonly WeightFallback[];
  /**
   * Script families the texts need whose faces the coverage source does not have,
   * each once, in the order first needed: their characters are measured without them. Empty
   * without a source.
   */
  readonly unmeasuredFamilies: readonly string[];
}

/** The texts being measured and where their script faces' files are read. */
export interface CoverageMeasuring {
  /** The text of each run set, in the same order. */
  readonly texts: readonly string[];
  /** Reads a coverage face's file (`coverageFontFile` names it): a server's files on disk. */
  readonly coverage: SyncFontBytesSource;
}

/** Each source's parsed coverage faces by face id, `null` for a face it lacks: read once. */
const coverageFacesBySource = new WeakMap<SyncFontBytesSource, Map<string, FontMetrics | null>>();

/**
 * A coverage face's metrics, parsed from its file, or the source's table for it when it has no
 * file, once per source.
 *
 * @param source - Where the file is read.
 * @param face - The face.
 * @returns Its metrics, or `undefined` when the source has neither.
 */
function coverageFaceMetrics(
  source: SyncFontBytesSource,
  face: FontFaceKey,
): FontMetrics | undefined {
  const faces = coverageFacesBySource.get(source) ?? new Map<string, FontMetrics | null>();
  coverageFacesBySource.set(source, faces);
  const faceId = fontFaceId(face);
  let metrics = faces.get(faceId);
  if (metrics === undefined) {
    const bytes = source.bytesOf(face);
    // A face the source has no file for may still have a table (the CJK faces).
    metrics =
      bytes === undefined
        ? (source.metricsOf?.(face) ?? null)
        : createFontMetrics(face, parseFont(bytes));
    faces.set(faceId, metrics);
  }
  return metrics ?? undefined;
}

/**
 * The script faces some texts need, parsed from a coverage source.
 *
 * @param runSets - The runs of each text.
 * @param measuring - The texts, one per run set, and the source.
 * @returns The faces' metrics, and the families whose faces the source lacks.
 */
function scriptFaces(
  runSets: readonly (readonly StyleRun[])[],
  measuring: CoverageMeasuring,
): { readonly fonts: readonly FontMetrics[]; readonly unmeasured: readonly string[] } {
  const families = new Set<string>();
  runSets.forEach((runs, index) => {
    for (const family of scriptCoverageFamilies(elementAt(measuring.texts, index), runs)) {
      families.add(family);
    }
  });
  const fonts: FontMetrics[] = [];
  const unmeasured: string[] = [];
  for (const family of families) {
    const faces = COVERAGE_FONT_FILES.filter(([listed]) => listed === family).map(
      ([, weight, isItalic]) =>
        coverageFaceMetrics(measuring.coverage, { family, weight, isItalic }),
    );
    if (faces.length === 0 || faces.some((face) => face === undefined)) unmeasured.push(family);
    else fonts.push(...faces.filter((face): face is FontMetrics => face !== undefined));
  }
  return { fonts, unmeasured };
}

/**
 * The bundled fonts some texts are set in, as the app has them once their families are loaded:
 * the default family (Liberation Sans) first, then each family the runs name; a family the app
 * does not bundle is reported and its fallback loaded in its place, never silently swapped, and
 * so is a weight a bundled family lacks, drawn with its nearest face.
 *
 * Given the texts and a coverage source (a server's files), it adds the script faces the texts
 * need (`scriptCoverageFamilies`), parsed from their files, so script text is measured with the
 * faces the app draws it with; a family the source lacks is reported instead.
 *
 * @param runSets - The runs of each text to be measured.
 * @param measuring - The texts and where their script faces are read; without it, no script
 *   faces.
 * @returns The faces' metrics, the unknown families, the weight fallbacks and the unmeasured
 *   script families.
 */
export function measuringFontsFor(
  runSets: readonly (readonly StyleRun[])[],
  measuring?: CoverageMeasuring,
): MeasuringFonts {
  const loaded = new Map<string, readonly FontMetrics[]>();
  const unknownFamilies: UnknownFamily[] = [];
  const load = (family: string): boolean => {
    if (loaded.has(family)) return true;
    const faces = bundledFamilyMetrics(family);
    if (faces !== undefined) loaded.set(family, faces);
    return faces !== undefined;
  };
  load(DEFAULT_FONT_FAMILY);
  for (const runs of runSets) {
    for (const { style } of runs) {
      const family = style.fontFamily;
      if (unknownFamilies.some((entry) => entry.family === family) || load(family)) {
        continue;
      }
      const fallback = fallbackFamily(family);
      unknownFamilies.push({ family, measuredWith: fallback });
      load(fallback);
    }
  }
  const weightFallbacks: WeightFallback[] = [];
  for (const runs of runSets) {
    for (const { style } of runs) {
      const faces = loaded.get(style.fontFamily);
      if (faces === undefined) continue;
      const { weight, italic: isItalic } = style;
      const family = style.fontFamily;
      const drawn = resolveFontFace(
        faces.map(({ face }) => face),
        fontFaceOf(style),
      );
      const isListed = weightFallbacks.some(
        (entry) =>
          entry.family === family && entry.weight === weight && entry.isItalic === isItalic,
      );
      if (drawn !== undefined && drawn.weight !== weight && !isListed) {
        weightFallbacks.push({ family, weight, isItalic, drawnWeight: drawn.weight });
      }
    }
  }
  const scripts = measuring === undefined ? undefined : scriptFaces(runSets, measuring);
  return {
    fonts: [...[...loaded.values()].flat(), ...(scripts?.fonts ?? []), ...symbolCoverageMetrics()],
    unknownFamilies,
    weightFallbacks,
    unmeasuredFamilies: scripts?.unmeasured ?? [],
  };
}

/** A text's laid-out size. */
export interface TextMeasurement {
  /** The longest line's width, world units. */
  readonly width: number;
  /** The lines' total height, world units. */
  readonly height: number;
  /** How many lines the text breaks into. */
  readonly lineCount: number;
}

/** A text box's alignment and base direction, as measuring takes them. */
export interface TextBoxDirection {
  /** The alignment of each line; absent is left. */
  readonly align?: TextAlign | undefined;
  /** The base direction of each paragraph; absent is auto. */
  readonly direction?: TextBaseDirection | undefined;
  /** One style per paragraph: lists indent. All plain when absent. */
  readonly paragraphs?: readonly ParagraphStyle[] | undefined;
}

/**
 * Measures a text as the app lays it out (`layoutText`): breaking at newlines and, given a
 * width, wrapping at it, each character its font lacks set in the symbol face that has it, as
 * the engine sets it (`coverageMeasureRuns`). Pure.
 *
 * @param text - The characters.
 * @param runs - Their style runs, covering the text.
 * @param wrapWidth - The width to wrap at, world units, or `null` to break only at newlines.
 * @param fonts - The faces' metrics, from {@link measuringFontsFor}.
 * @param measurer - What measures the glyphs: the shaping measurer of `prepareMeasuringFonts`,
 * or, by default, the faces' per-codepoint metrics.
 * @param box - The box's alignment and base direction, as `layoutText` takes them;
 *   by default left and auto.
 * @returns Its width, height and line count.
 * @throws {RangeError} When `fonts` is empty or the runs do not cover the text.
 */
export function measureText(
  text: string,
  runs: readonly StyleRun[],
  wrapWidth: number | null,
  fonts: readonly FontMetrics[],
  measurer: GlyphMeasurer = createMetricsMeasurer(fonts),
  box: TextBoxDirection = {},
): TextMeasurement {
  const measured = coverageMeasureRuns(text, runs, fonts);
  const { align = 'left', direction = 'auto', paragraphs } = box;
  // Plain text lays out with the same six arguments as before lists.
  const lists = paragraphs === undefined ? [] : ([paragraphs] as const);
  const layout = layoutText(text, measured, wrapWidth, measurer, align, direction, ...lists);
  return { width: layout.width, height: layout.height, lineCount: layout.lines.length };
}
