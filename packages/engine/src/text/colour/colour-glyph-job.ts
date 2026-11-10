// The glyph job's colour step: after the distance fields of a batch are made, a face
// with colour glyphs has each glyph with a colour paint rasterised as a premultiplied RGBA bitmap
// instead, at the batch's tier, over its advance by the font's line extent widened to take in
// wherever its paint reaches (a clip box may pass both), up to MAX_OVERHANG_EM.

import { loadShaper, parseFont, type ParsedFont, type Shaper } from '@canvas/text';

import type { JobHandler, JobOutcome } from '../../workers/job-handlers.js';
import { glyphIdOfKey } from '../atlas/glyph-key.js';
import { fontBytesOf, type GeneratedGlyph, type MsdfJobRequest } from '../msdf/msdf-job-payload.js';

import { paintBounds, unionBox } from './colour-bounds.js';
import type { ColourCanvasFactory } from './colour-canvas.js';
import { rasterColourGlyph, type ColourGlyphBox } from './colour-raster.js';

/** How far, in em, a colour glyph's paint may reach past its advance and line box. */
export const MAX_OVERHANG_EM = 1;

/** What the colour step needs besides the canvas. */
export interface ColourGlyphJobOptions {
  /** Loads HarfBuzz; `loadShaper` by default. */
  readonly load?: () => Promise<Shaper>;
  /** Parses a batch's face (the glyph job's own cache); `parseFont` of its bytes by default. */
  readonly parse?: (request: MsdfJobRequest) => ParsedFont;
}

/**
 * Wraps a glyph job handler so colour glyphs come back as colour bitmaps.
 *
 * @param handler - The distance-field handler.
 * @param canvas - The canvases colour glyphs are rasterised with.
 * @param options - How HarfBuzz loads and the face is parsed.
 * @returns The handler.
 */
export function withColourGlyphs(
  handler: JobHandler<'msdf'>,
  canvas: ColourCanvasFactory,
  options: ColourGlyphJobOptions = {},
): JobHandler<'msdf'> {
  const load = options.load ?? loadShaper;
  const parse = options.parse ?? ((request: MsdfJobRequest) => parseFont(fontBytesOf(request)));
  let shaper: Promise<Shaper> | undefined;
  return async (request) => {
    const fields = await handler(request);
    shaper ??= load();
    return colourOutcome(fields, request, { shaper: await shaper, canvas, parse });
  };
}

/** The colour step's tools for one batch. */
interface ColourTools {
  readonly shaper: Shaper;
  readonly canvas: ColourCanvasFactory;
  readonly parse: (request: MsdfJobRequest) => ParsedFont;
}

/**
 * The box a colour glyph is drawn over: its advance by the line extent, widened to where its
 * paint reaches, at most {@link MAX_OVERHANG_EM} past either.
 *
 * @param metrics - The advance by the line extent, em.
 * @param paint - Where the paint reaches, when bounded.
 * @returns The box.
 */
export function colourGlyphBox(
  metrics: ColourGlyphBox,
  paint: ColourGlyphBox | undefined,
): ColourGlyphBox {
  if (paint === undefined) return metrics;
  const box = unionBox(metrics, paint);
  return {
    xMin: Math.max(box.xMin, metrics.xMin - MAX_OVERHANG_EM),
    yMin: Math.max(box.yMin, metrics.yMin - MAX_OVERHANG_EM),
    xMax: Math.min(box.xMax, metrics.xMax + MAX_OVERHANG_EM),
    yMax: Math.min(box.yMax, metrics.yMax + MAX_OVERHANG_EM),
  };
}

/**
 * A batch's outcome with each glyph that has a colour paint replaced by its colour bitmap; the
 * same outcome for a face without colour glyphs.
 *
 * @param fields - The distance-field outcome.
 * @param request - The batch.
 * @param tools - HarfBuzz, the canvases and the face's parser.
 * @returns The outcome.
 */
async function colourOutcome(
  fields: JobOutcome<'msdf'>,
  request: MsdfJobRequest,
  tools: ColourTools,
): Promise<JobOutcome<'msdf'>> {
  const { shaper, canvas } = tools;
  // The face's id is its font key, as the raster fallback and the layout jobs name it, opened at
  // the batch's coordinates as they open it.
  const face = shaper.face(
    request.fontKey,
    new Uint8Array(fontBytesOf(request)),
    request.variations,
  );
  if (!shaper.hasColourGlyphs(face)) return fields;
  let font: ParsedFont;
  try {
    font = tools.parse(request);
  } catch {
    return fields;
  }
  const glyphs: GeneratedGlyph[] = [];
  for (const glyph of fields.response.glyphs) {
    const glyphId = glyphIdOfKey(glyph.key) ?? font.glyphIdOf(glyph.key);
    const program = glyphId === 0 ? undefined : shaper.colourGlyph(face, glyphId);
    if (program === undefined) {
      glyphs.push(glyph);
      continue;
    }
    const advance = font.advanceOf(glyphId);
    const metrics = { xMin: 0, yMin: -font.descent, xMax: advance, yMax: font.ascent };
    const box = colourGlyphBox(metrics, paintBounds(program));
    const bitmap = await rasterColourGlyph(program, { canvas, tier: request.tier, box, advance });
    glyphs.push({ key: glyph.key, bitmap });
  }
  return {
    response: { ...fields.response, glyphs },
    transfer: glyphs.map(({ bitmap }) => bitmap.pixels.buffer),
  };
}
