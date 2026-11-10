import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import type { FontMetrics } from '../font/font-metrics.js';
import { createMetricsMeasurer, type GlyphMeasurer } from '../layout/glyph-measurer.js';
import { shapeWithMetrics } from '../shaping/metrics-shaping.js';
import type { Shaper } from '../shaping/shaper.js';
import { shapingMeasurer, type ShapingMeasurer } from '../shaping/shaping-measurer.js';
import type { Subsetter } from '../slices/subsetter.js';

/**
 * Reads bundled faces' font files synchronously: a server's files on disk, the page's
 * loaded fonts. `bundledFontFile` names each face's file.
 */
export interface SyncFontBytesSource {
  /**
   * Reads a face's font file.
   *
   * @param face - The face.
   * @returns Its bytes, or `undefined` when the source lacks it.
   */
  bytesOf(face: FontFaceKey): Uint8Array | undefined;
  /**
   * A face's metrics when the source has a table for it but no file (the CJK faces
   * a server measures without deploying them): it is then measured, and shaped, from them.
   *
   * @param face - The face.
   * @returns Its metrics, or `undefined` when the source has no table for it.
   */
  metricsOf?(face: FontFaceKey): FontMetrics | undefined;
}

/**
 * Shapes measured text with HarfBuzz, synchronously, once the shaper has loaded: built
 * once where text is measured (a server at startup, the page once its fonts load) and passed to
 * whatever measures, so measuring stays synchronous.
 */
export interface TextShaping {
  /**
   * A measurer that shapes with the faces' files.
   *
   * @param fonts - The faces' metrics, from `measuringFontsFor`.
   * @returns A shaping measurer over exactly those faces.
   * @throws {Error} When the source has no file for one of them.
   */
  measurerFor(fonts: readonly FontMetrics[]): GlyphMeasurer;
  /**
   * Where the script faces' files are read, when this shaping measures script text with them (a
   * server's): pass it to `measuringFontsFor` with the texts. Absent elsewhere.
   */
  readonly coverage?: SyncFontBytesSource;
  /**
   * The shaper the measurers shape with, so a caller can outline the glyphs they shaped (the
   * vector export). Absent for a shaping built otherwise.
   */
  readonly shaper?: Shaper;
  /**
   * A face's font file, once a measurer has read it (the vector export outlines and
   * embeds the faces a layout used).
   *
   * @param faceId - The face, as a layout names it (`fontFaceId`).
   * @returns Its bytes, or `undefined` for a face no measurer has read.
   */
  fontFileOf?(faceId: string): Uint8Array | undefined;
  /**
   * Cuts a font file down to some characters (hb-subset), so the vector export embeds only the
   * glyphs a document draws from a large face (a CJK slice). Absent where none loaded.
   */
  readonly subsetter?: Subsetter;
}

/** A face's font file a measurement needs and its source lacks. */
export class MissingFontFileError extends Error {
  /**
   * Names the missing face.
   *
   * @param face - The face whose file the source lacks.
   */
  constructor(readonly face: FontFaceKey) {
    const slant = face.isItalic ? ' italic' : '';
    super(`No font file for ${face.family} ${String(face.weight)}${slant}.`);
    this.name = 'MissingFontFileError';
  }
}

/** How a shaping service reads its faces' files. */
export interface TextShapingOptions {
  /**
   * `eagerly` (the default): `measurerFor` reads every face's file and throws for a missing one.
   * `when-shaped`: a face's file is read when text is first shaped with it, so a source that
   * loads faces on demand (the page) is asked only for the faces a text uses; a missing file
   * then throws from the measurement, and is asked for again the next time.
   */
  readonly readFiles?: 'eagerly' | 'when-shaped';
  /** Where script faces' files are read, kept as the shaping's `coverage`. */
  readonly coverage?: SyncFontBytesSource;
}

/**
 * Builds the shaping service over a loaded shaper and a source of font files. Each face's file
 * is read once and kept, so the shaper reuses its HarfBuzz face.
 *
 * @param shaper - The loaded shaper (`loadShaper`).
 * @param source - Where the faces' files are read.
 * @param options - When the files are read; eagerly by default.
 * @returns The service.
 */
export function createTextShaping(
  shaper: Shaper,
  source: SyncFontBytesSource,
  options: TextShapingOptions = {},
): TextShaping {
  const files = new Map<string, Uint8Array>();
  const fileOf = (face: FontFaceKey): Uint8Array => {
    const faceId = fontFaceId(face);
    const known = files.get(faceId);
    if (known !== undefined) return known;
    const bytes = source.bytesOf(face);
    if (bytes === undefined) throw new MissingFontFileError(face);
    files.set(faceId, bytes);
    return bytes;
  };
  // A face with no file but a coverage table is shaped from its metrics.
  // Decided once per face: the table is asked first, so a face without one is never read here.
  const tableOnlyFaces = new Map<string, boolean>();
  const isMetricsOnly = (face: FontFaceKey): boolean => {
    const faceId = fontFaceId(face);
    let isTableOnly = tableOnlyFaces.get(faceId);
    if (isTableOnly === undefined) {
      isTableOnly =
        options.coverage?.metricsOf?.(face) !== undefined &&
        !files.has(faceId) &&
        source.bytesOf(face) === undefined;
      tableOnlyFaces.set(faceId, isTableOnly);
    }
    return isTableOnly;
  };
  const coverage = options.coverage === undefined ? {} : { coverage: options.coverage };
  const fontFileOf = (faceId: string): Uint8Array | undefined => files.get(faceId);
  if (options.readFiles !== 'when-shaped') {
    return {
      measurerFor: (fonts) => {
        const tableOnly = new Set(
          fonts.filter(({ face }) => isMetricsOnly(face)).map(({ face }) => fontFaceId(face)),
        );
        const measurer = shapingMeasurer(
          shaper,
          fonts.map((metrics) => ({
            metrics,
            bytes: tableOnly.has(fontFaceId(metrics.face))
              ? new Uint8Array()
              : fileOf(metrics.face),
          })),
        );
        return withMetricsShaping(measurer, fonts, tableOnly);
      },
      shaper,
      fontFileOf,
      ...coverage,
    };
  }
  return {
    measurerFor: (fonts) =>
      withMetricsShaping(
        lazyShapingMeasurer(shaper, fonts, fileOf),
        fonts,
        new Set(
          fonts.filter(({ face }) => isMetricsOnly(face)).map(({ face }) => fontFaceId(face)),
        ),
      ),
    shaper,
    fontFileOf,
    ...coverage,
  };
}

/**
 * A shaping measurer that reads each face's file when text is first shaped with it.
 *
 * @param shaper - The loaded shaper.
 * @param fonts - The faces' metrics.
 * @param fileOf - Reads a face's file; throws `MissingFontFileError` when it is missing.
 * @returns The measurer.
 */
function lazyShapingMeasurer(
  shaper: Shaper,
  fonts: readonly FontMetrics[],
  fileOf: (face: FontFaceKey) => Uint8Array,
): ShapingMeasurer {
  const metrics = createMetricsMeasurer(fonts);
  const byFace = new Map(fonts.map((font) => [fontFaceId(font.face), font] as const));
  const shapers = new Map<string, GlyphMeasurer>();
  const shapingOf = (faceId: string): GlyphMeasurer => {
    let measurer = shapers.get(faceId);
    if (measurer === undefined) {
      const font = byFace.get(faceId);
      if (font === undefined) throw new RangeError(`No font file for face "${faceId}".`);
      measurer = shapingMeasurer(shaper, [{ metrics: font, bytes: fileOf(font.face) }]);
      shapers.set(faceId, measurer);
    }
    return measurer;
  };
  return {
    faceIdOf: (style) => metrics.faceIdOf(style),
    advance: (faceId, codepoint) => metrics.advance(faceId, codepoint),
    kerning: (faceId, left, right) => metrics.kerning(faceId, left, right),
    lineMetrics: (faceId) => metrics.lineMetrics(faceId),
    shape: (faceId, text, start, end, direction, variations, language, features) => {
      const shaped = shapingOf(faceId).shape?.(
        faceId,
        text,
        start,
        end,
        direction,
        variations,
        language,
        features,
      );
      if (shaped === undefined) throw new RangeError(`Face "${faceId}" cannot shape.`);
      return shaped;
    },
    variationsOf: (faceId, requested) => {
      const variations = shapingOf(faceId).variationsOf?.(faceId, requested);
      if (variations === undefined) throw new RangeError(`Face "${faceId}" cannot shape.`);
      return variations;
    },
  };
}

/**
 * A measurer that shapes the faces measured from a table alone from their metrics
 * (`shapeWithMetrics`), and every other face as the given measurer does.
 *
 * @param measurer - The shaping measurer.
 * @param fonts - The faces' metrics.
 * @param tableOnly - The ids of the faces with no file.
 * @returns The measurer; the given one when every face has a file.
 */
function withMetricsShaping(
  measurer: GlyphMeasurer & Required<Pick<GlyphMeasurer, 'shape' | 'variationsOf'>>,
  fonts: readonly FontMetrics[],
  tableOnly: ReadonlySet<string>,
): GlyphMeasurer {
  if (tableOnly.size === 0) return measurer;
  const byFace = new Map(fonts.map((font) => [fontFaceId(font.face), font] as const));
  return {
    ...measurer,
    shape: (faceId, text, start, end, direction, variations, language, features) => {
      const table = tableOnly.has(faceId) ? byFace.get(faceId) : undefined;
      if (table !== undefined) return shapeWithMetrics(table, text, start, end, direction);
      return measurer.shape(faceId, text, start, end, direction, variations, language, features);
    },
    // A table holds the face's default instance only.
    variationsOf: (faceId, requested) =>
      tableOnly.has(faceId) ? {} : measurer.variationsOf(faceId, requested),
  };
}
