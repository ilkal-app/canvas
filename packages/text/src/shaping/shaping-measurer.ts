import { fontFaceId } from '../font/font-face.js';
import type { FontMetrics } from '../font/font-metrics.js';
import { createMetricsMeasurer, type GlyphMeasurer } from '../layout/glyph-measurer.js';

import { shapeText, type Shaper, type ShapingFace } from './shaper.js';

/** A face's file and its metrics: the metrics name the face and give its line metrics. */
export interface ShapingFont {
  /** The face's metrics: its descriptor, ascent and descent. */
  readonly metrics: FontMetrics;
  /** The font file HarfBuzz shapes with. */
  readonly bytes: Uint8Array;
  /**
   * Names these bytes in the shaper, which keeps a HarfBuzz face per id while its byte budget
   * allows and reads it again from the bytes after: the same id must always mean the same bytes
   * (the engine passes `fontKey`). Without one, the
   * bytes object itself is the identity, so other bytes for the same face never reuse it.
   */
  readonly shapingId?: string;
}

/** A measurer that shapes: its `shape` and `variationsOf` are always there. */
export type ShapingMeasurer = GlyphMeasurer &
  Required<Pick<GlyphMeasurer, 'shape' | 'variationsOf'>>;

/** An id per font file object, for files given without a shaping id. */
const idsOfFiles = new WeakMap<Uint8Array, string>();
let fileCount = 0;

/**
 * The shaper id of a face's file.
 *
 * @param font - The face's file, metrics and optional id.
 * @returns Its `shapingId`, or an id unique to its bytes object.
 */
function shapingIdOf(font: ShapingFont): string {
  if (font.shapingId !== undefined) return font.shapingId;
  let id = idsOfFiles.get(font.bytes);
  if (id === undefined) {
    fileCount += 1;
    id = `${fontFaceId(font.metrics.face)}#file${String(fileCount)}`;
    idsOfFiles.set(font.bytes, id);
  }
  return id;
}

/**
 * A measurer whose layout shapes every segment with HarfBuzz: faces resolve as the
 * metrics measurer resolves them, line metrics come from the metrics, and glyphs, advances and
 * kerning from shaping, at a run's variable-font coordinates. A face is handed to the
 * shaper the first time it shapes.
 *
 * @param shaper - The shaper, from `loadShaper`.
 * @param fonts - The faces, the first the default.
 * @returns The measurer.
 */
export function createShapingMeasurer(
  shaper: Shaper,
  fonts: readonly ShapingFont[],
): GlyphMeasurer {
  return shapingMeasurer(shaper, fonts);
}

/**
 * {@link createShapingMeasurer}, typed as the measurer that shapes it is.
 *
 * @param shaper - The shaper, from `loadShaper`.
 * @param fonts - The faces, the first the default.
 * @returns The measurer.
 */
export function shapingMeasurer(shaper: Shaper, fonts: readonly ShapingFont[]): ShapingMeasurer {
  const metrics = createMetricsMeasurer(fonts.map((font) => font.metrics));
  const files = new Map(fonts.map((font) => [fontFaceId(font.metrics.face), font] as const));
  // The shaper keeps a face per id and coordinates while it keeps the file; asked again, it
  // returns the same face, or an equivalent one once the file was dropped and read again.
  const faceOf = (faceId: string, variations?: Readonly<Record<string, number>>): ShapingFace => {
    const file = files.get(faceId);
    if (file === undefined) throw new RangeError(`No font file for face "${faceId}".`);
    return shaper.face(shapingIdOf(file), file.bytes, variations);
  };
  return {
    faceIdOf: (style) => metrics.faceIdOf(style),
    advance: (faceId, codepoint) => metrics.advance(faceId, codepoint),
    kerning: (faceId, left, right) => metrics.kerning(faceId, left, right),
    lineMetrics: (faceId) => metrics.lineMetrics(faceId),
    shape: (faceId, text, start, end, direction, variations, language, features) =>
      shapeText(
        shaper,
        faceOf(faceId, variations),
        text,
        start,
        end,
        direction,
        language,
        features,
      ),
    variationsOf: (faceId, requested) => faceOf(faceId, requested).variations,
  };
}
