import * as text from '../../index.js';
import type { FontMetrics, GlyphMeasurer, LayoutGlyph, TextLayout } from '../../index.js';

/** The shaping face contract, kept in tests until the production export exists. */
export interface ShapingFace {
  readonly id: string;
  readonly unitsPerEm: number;
}

/** The shaper contract. */
export interface Shaper {
  readonly version: string;
  face(id: string, bytes: Uint8Array): ShapingFace;
}

/** One shaped glyph in HarfBuzz buffer order. */
export interface ShapedGlyph {
  readonly glyphId: number;
  readonly cluster: number;
  readonly advance: number;
  readonly xOffset: number;
  readonly yOffset: number;
  readonly isUnsafeToBreak: boolean;
}

/** One directional shaping result. */
export interface ShapedRun {
  readonly direction: 'ltr' | 'rtl';
  readonly glyphs: readonly ShapedGlyph[];
}

/** A test font's metrics and raw bytes. */
export interface ShapingFont {
  readonly metrics: FontMetrics;
  readonly bytes: Uint8Array;
}

/** The fields added to each layout glyph. */
export type ClusterLayoutGlyph = LayoutGlyph & {
  readonly glyphId: number | null;
  readonly end: number;
};

/** The layout result after. */
export type ClusterTextLayout = Omit<TextLayout, 'glyphs'> & {
  readonly glyphs: readonly ClusterLayoutGlyph[];
};

interface ShapingExports {
  loadShaper(): Promise<Shaper>;
  shapeText(
    shaper: Shaper,
    face: ShapingFace,
    source: string,
    start: number,
    end: number,
  ): ShapedRun;
  createShapingMeasurer(shaper: Shaper, fonts: readonly ShapingFont[]): GlyphMeasurer;
}

// The cast describes the proposed public API. Missing runtime exports must make these tests red.
const proposed = text as typeof text & ShapingExports;

/**
 * Loads the proposed shaper export from the package root.
 *
 * @returns A cached shaper.
 */
export const loadShaper = (): Promise<Shaper> => proposed.loadShaper();
/**
 * Shapes through the proposed package-root export.
 *
 * @param shaper - The shaper.
 * @param face - The font face.
 * @param source - The whole source text.
 * @param start - The first UTF-16 index.
 * @param end - The exclusive last UTF-16 index.
 * @returns Glyphs in HarfBuzz buffer order.
 */
export const shapeText = (
  shaper: Shaper,
  face: ShapingFace,
  source: string,
  start: number,
  end: number,
): ShapedRun => proposed.shapeText(shaper, face, source, start, end);
/**
 * Builds the proposed shaping measurer through the package root.
 *
 * @param shaper - The shaper.
 * @param fonts - Bundled font files and metrics.
 * @returns A measurer that shapes layout segments.
 */
export const createShapingMeasurer = (
  shaper: Shaper,
  fonts: readonly ShapingFont[],
): GlyphMeasurer => proposed.createShapingMeasurer(shaper, fonts);

/**
 * Gives the existing layout export its proposed glyph result type in acceptance tests.
 *
 * @param source - The text.
 * @param runs - The style runs.
 * @param maxWidth - The wrap width.
 * @param measurer - The font measurer.
 * @returns The layout result.
 */
export function layoutText(
  source: Parameters<typeof text.layoutText>[0],
  runs: Parameters<typeof text.layoutText>[1],
  maxWidth: Parameters<typeof text.layoutText>[2],
  measurer: Parameters<typeof text.layoutText>[3],
): ClusterTextLayout {
  return text.layoutText(source, runs, maxWidth, measurer);
}
