import type { TextStyle } from '@canvas/schema';

import { DECORATION_KEYS, type DecorationMetrics } from '../font/decoration-metrics.js';
import { fontFaceId, fontFaceOf, resolveFontFace } from '../font/font-face.js';
import { FontMetricsLookup, type FontMetrics } from '../font/font-metrics.js';
import type { ShapedRun } from '../shaping/shaper.js';
import type { TextDirection } from '../shaping/text-direction.js';

/** A face's ascent and descent, and where it draws underlines and strikethroughs, in em. */
export interface LineMetrics extends DecorationMetrics {
  /** Height above the baseline, in em. */
  readonly ascent: number;
  /** Depth below the baseline, in em, positive. */
  readonly descent: number;
}

/**
 * What layout asks of fonts (the prototype's `GlyphMeasurer`, `src/text/measure.ts`, without
 * Canvas2D): which face draws a style, and advances, kerning and line metrics in em.
 */
export interface GlyphMeasurer {
  /**
   * The face that draws a style, after fallbacks.
   *
   * @param style - A run's style.
   * @returns The face id.
   */
  faceIdOf(style: TextStyle): string;
  /**
   * A character's advance.
   *
   * @param faceId - The face.
   * @param codepoint - The character.
   * @returns The advance, in em.
   */
  advance(faceId: string, codepoint: number): number;
  /**
   * The kerning between two characters of the same face and size.
   *
   * @param faceId - The face.
   * @param left - The character on the left.
   * @param right - The character on the right.
   * @returns The adjustment to the left advance, in em.
   */
  kerning(faceId: string, left: number, right: number): number;
  /**
   * A face's ascent and descent.
   *
   * @param faceId - The face.
   * @returns Its line metrics, in em.
   */
  lineMetrics(faceId: string): LineMetrics;
  /**
   * Shapes a stretch of text with a face: present on a measurer that shapes, and then
   * layout shapes every segment with it, and `advance` and `kerning` are not used.
   *
   * @param faceId - The face.
   * @param text - The whole text.
   * @param start - The first UTF-16 index to shape.
   * @param end - One past the last.
   * @param direction - The direction to shape in (the bidi level's); guessed when absent.
   * @param variations - The variable-font coordinates to shape at, as
   *   {@link GlyphMeasurer.variationsOf} gave them; the face's defaults when absent.
   * @param language - The text's language, a BCP 47 tag; none when absent.
   * @param features - OpenType feature settings, tag to value; the shaper's defaults
   *   when absent.
   * @returns The glyphs, in visual order, in em.
   */
  readonly shape?: (
    faceId: string,
    text: string,
    start: number,
    end: number,
    direction?: TextDirection,
    variations?: Readonly<Record<string, number>>,
    language?: string,
    features?: Readonly<Record<string, number>>,
  ) => ShapedRun;
  /**
   * The variable-font coordinates a face is shaped at for requested ones: normalised
   * against the face's own axes, empty for a static face or its defaults. A measurer without it
   * measures every face at its defaults, as one that does not shape must: font metrics tables
   * hold the default instance only.
   *
   * @param faceId - The face.
   * @param requested - The run's coordinates, by axis tag.
   * @returns The coordinates to shape at.
   */
  readonly variationsOf?: (
    faceId: string,
    requested: Readonly<Record<string, number>>,
  ) => Readonly<Record<string, number>>;
}

/**
 * A measurer over plain {@link FontMetrics} tables: what a `layout` job builds from its
 * payload, on a worker or on the main thread. Styles resolve to the listed faces with
 * `resolveFontFace`'s fallbacks.
 *
 * @param fonts - The metrics of every face the text may use; the first is the default.
 * @returns The measurer.
 * @throws {RangeError} When `fonts` is empty: text cannot be laid out without a face.
 */
export function createMetricsMeasurer(fonts: readonly FontMetrics[]): GlyphMeasurer {
  const defaultFace = fonts[0]?.face;
  if (defaultFace === undefined) throw new RangeError('Layout needs the metrics of a face.');
  const faces = fonts.map(({ face }) => face);
  const lookups = new Map(fonts.map((metrics) => [fontFaceId(metrics.face), metrics] as const));
  const indexed = new Map<string, FontMetricsLookup>();
  const lookupOf = (faceId: string): FontMetricsLookup => {
    let lookup = indexed.get(faceId);
    if (lookup === undefined) {
      const metrics = lookups.get(faceId);
      if (metrics === undefined) throw new RangeError(`No metrics for face "${faceId}".`);
      lookup = new FontMetricsLookup(metrics);
      indexed.set(faceId, lookup);
    }
    return lookup;
  };
  return {
    faceIdOf: (style) => fontFaceId(resolveFontFace(faces, fontFaceOf(style)) ?? defaultFace),
    advance: (faceId, codepoint) => lookupOf(faceId).advance(codepoint),
    kerning: (faceId, left, right) => lookupOf(faceId).kerning(left, right),
    lineMetrics: (faceId) => {
      const metrics = lookups.get(faceId);
      if (metrics === undefined) throw new RangeError(`No metrics for face "${faceId}".`);
      // With the decoration metrics the face gives.
      const line: { -readonly [Key in keyof LineMetrics]: LineMetrics[Key] } = {
        ascent: metrics.ascent,
        descent: metrics.descent,
      };
      for (const key of DECORATION_KEYS) {
        const value = metrics[key];
        if (value !== undefined) line[key] = value;
      }
      return line;
    },
  };
}
