// A laid-out text as vectors: each glyph's outline placed in the text box as SVG path
// data and PDF path operators, and a colour glyph as its painted layers or bitmap. The outlines
// are the shaper's, the same ones the engine's vector tier draws. Pure.
import type { GlyphOutline } from '../font/glyph-outline.js';
import type { LayoutGlyph, TextLayout } from '../layout/text-layout.js';
import type { ColourGlyphProgram } from '../shaping/colour-glyph.js';

import {
  colourLayers,
  type VectorFill,
  type VectorGroup,
  type VectorImage,
  type VectorLayer,
} from './colour-layers.js';
import { glyphPathData, glyphPdfPath, glyphTransform } from './glyph-path-data.js';

/** The UTF-16 range of the text a glyph draws. */
export interface VectorCluster {
  /** The first code unit. */
  readonly start: number;
  /** The code unit after the last. */
  readonly end: number;
}

/** What every vector glyph carries. */
interface VectorGlyphBase {
  /** The shaped glyph id. */
  readonly glyphId: number;
  /** The face that draws it. */
  readonly faceId: string;
  /** The UTF-16 range of the text it draws (several characters for a ligature). */
  readonly cluster: VectorCluster;
  /** Its outline's SVG path data in the text box; a colour glyph's plain outline, maybe empty. */
  readonly d: string;
  /** Its outline's PDF path operators in the text box. */
  readonly pdf: string;
  /** Its run's colour. */
  readonly fill: VectorFill;
}

/** A plain glyph: its outline, filled with the run's colour. */
export interface OutlineVectorGlyph extends VectorGlyphBase {
  /** Discriminates the glyphs. */
  readonly kind: 'outline';
  /** None. */
  readonly layers?: undefined;
  /** None. */
  readonly groups?: undefined;
  /** None. */
  readonly image?: undefined;
}

/** A colour glyph painted in layers. */
export interface LayersVectorGlyph extends VectorGlyphBase {
  /** Discriminates the glyphs. */
  readonly kind: 'layers';
  /** Its layers, in paint order. */
  readonly layers: readonly VectorLayer[];
  /** The groups its layers name, with their composite modes. */
  readonly groups: readonly VectorGroup[];
  /** None. */
  readonly image?: undefined;
}

/** A bitmap colour glyph. */
export interface ImageVectorGlyph extends VectorGlyphBase {
  /** Discriminates the glyphs. */
  readonly kind: 'image';
  /** Its placed bitmap. */
  readonly image: VectorImage;
  /** None. */
  readonly layers?: undefined;
  /** None. */
  readonly groups?: undefined;
}

/** One glyph as vectors, in layout order: an outline, a colour glyph's layers, or a bitmap. */
export type VectorGlyph = OutlineVectorGlyph | LayersVectorGlyph | ImageVectorGlyph;

/** Where a text's outlines and colour glyphs come from, by the layout's face ids. */
export interface VectorGlyphSource {
  /**
   * A glyph's outline, in em, y up.
   *
   * @param faceId - The face, as the layout names it.
   * @param glyphId - The shaped glyph id.
   * @returns The outline.
   */
  outline(faceId: string, glyphId: number): GlyphOutline;
  /**
   * A glyph's colour program, when the face paints it in colour.
   *
   * @param faceId - The face.
   * @param glyphId - The glyph.
   * @returns The program, or undefined for a plain glyph.
   */
  colourGlyph?(faceId: string, glyphId: number): ColourGlyphProgram | undefined;
}

/**
 * One glyph as vectors: a bitmap glyph that paints no layers is its image, any other colour glyph
 * its layers, a plain glyph its outline.
 *
 * @param layout - The text's layout, for the glyph's run.
 * @param glyph - The glyph.
 * @param source - Outlines and colour programs.
 * @returns The vector glyph, or undefined for an unshaped glyph or one with no run.
 */
function glyphVector(
  layout: TextLayout,
  glyph: LayoutGlyph,
  source: VectorGlyphSource,
): VectorGlyph | undefined {
  const run = layout.runs[glyph.run];
  if (glyph.glyphId === null || run === undefined) return undefined;
  const placement = glyphTransform(glyph, run.fontSize);
  const outline = source.outline(run.faceId, glyph.glyphId);
  const base = {
    glyphId: glyph.glyphId,
    faceId: run.faceId,
    cluster: { start: glyph.index, end: glyph.end },
    d: glyphPathData(outline, placement),
    pdf: glyphPdfPath(outline, placement),
    fill: run.color,
  };
  const program = source.colourGlyph?.(run.faceId, glyph.glyphId);
  if (program === undefined) return { kind: 'outline', ...base };
  const { layers, groups, image } = colourLayers(program, placement, run.color);
  if (layers.length === 0 && image !== undefined) return { kind: 'image', ...base, image };
  return { kind: 'layers', ...base, layers, groups };
}

/**
 * A laid-out text as vectors, one entry per shaped glyph in layout (visual) order: its outline
 * placed in the text box (`translate(x, baseline) · scale(fontSize, −fontSize)`) as SVG path data
 * and PDF path operators, filled with its run's colour. A colour glyph is its painted layers, or
 * its bitmap. A glyph the layout could not shape (no glyph id) has no outline and is left out.
 *
 * @param layout - The text's layout.
 * @param source - Outlines and colour programs by face id.
 * @returns The vectors; the inputs are not changed.
 */
export function textVectors(layout: TextLayout, source: VectorGlyphSource): VectorGlyph[] {
  const vectors: VectorGlyph[] = [];
  for (const glyph of layout.glyphs) {
    const vector = glyphVector(layout, glyph, source);
    if (vector !== undefined) vectors.push(vector);
  }
  return vectors;
}
