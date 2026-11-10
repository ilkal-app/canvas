import type { Point } from '@canvas/schema';
import { SPACE } from '@canvas/text';
import type { TextLayout } from '@canvas/text';

import type { GlyphQuad } from '../renderer/glyph-instance.js';

import type { OrderedGlyphQuads, PagedGlyphQuad } from './ordered-glyph-quads.js';

/**
 * The page rectangle of a greek bar: all −1, which `scene-text.wgsl` draws as a flat quad in its
 * colour instead of sampling the atlas.
 */
export const GREEK_PAGE_RECT: readonly [number, number, number, number] = [-1, -1, -1, -1];

/** A greek bar's opacity, as a fraction of its run colour's (grey at 30%). */
export const GREEK_ALPHA = 0.3;

/** A greek bar's height, as a fraction of its line's: across the middle of the line. */
const BAR_FRACTION = 0.4;

/**
 * Whether a quad is a greek bar (drawn flat, not sampled from the atlas).
 *
 * @param quad - A text record's quad.
 * @returns True for a bar.
 */
export function isGreekQuad(quad: GlyphQuad): boolean {
  return quad.u0 < 0;
}

/**
 * Text as greyed bars: the cheap form of text whose lines are under 4 device pixels. Each
 * glyph that is not a space keeps its record and becomes a bar over its advance, across the middle
 * of its line (40% of the line tall), in its run colour at 30% of its opacity, so words read as
 * bars and a paragraph keeps its shape. Built from the cached layout alone: no atlas, no glyph
 * requests, and record `i` is glyph `i` as in `orderedGlyphQuads`. Bars sample no page
 * (`GREEK_PAGE_RECT`); they are on page 0. Pure.
 *
 * @param layout - The laid-out text.
 * @param origin - Where the laid-out text starts in the object's frame (`textOriginOf`).
 * @returns One bar per drawable glyph, complete.
 */
export function greekQuads(layout: TextLayout, origin: Point): OrderedGlyphQuads {
  const quads: PagedGlyphQuad[] = [];
  const [u0, v0, u1, v1] = GREEK_PAGE_RECT;
  for (const glyph of layout.glyphs) {
    if (glyph.codepoint === SPACE) continue;
    const line = layout.lines[glyph.line];
    const run = layout.runs[glyph.run];
    const lineTop = line?.y ?? 0;
    const lineHeight = line?.height ?? 0;
    const height = lineHeight * BAR_FRACTION;
    const color = run?.color ?? [0, 0, 0, 0];
    quads.push({
      pageId: 0,
      quad: {
        x: origin.x + glyph.x,
        y: origin.y + lineTop + (lineHeight - height) / 2,
        width: glyph.advance,
        height,
        u0,
        v0,
        u1,
        v1,
        ...(Array.isArray(color)
          ? { color: [color[0], color[1], color[2], color[3] * GREEK_ALPHA] }
          : { color, inkAlpha: GREEK_ALPHA }),
      },
    });
  }
  return { quads, tiers: [], isComplete: true, vectorRuns: [] };
}
