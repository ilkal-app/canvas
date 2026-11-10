import type { TextLayout } from '@canvas/text';

import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphRequester } from '../renderer/glyph-quads.js';

import { decorationQuads, markerLayoutOf } from './decoration-quads.js';
import { linkUnderlineQuads } from './link-underline.js';
import type { OrderedGlyphQuads, VectorGlyphPolicy } from './ordered-glyph-quads.js';
import { SharedGlyphQuads, type GlyphLookupSink } from './shared-glyph-quads.js';
import { SharedGreekQuads } from './shared-greek-quads.js';
import type { TextObjectEntry } from './text-object-entry.js';
import { textOriginOf } from './text-placement.js';

/** Local glyph and Greek geometry, independent of each object's world placement. */
export class TextObjectQuads {
  private readonly greek = new SharedGreekQuads();
  private readonly glyphs: SharedGlyphQuads;

  /**
   * Binds the renderer-owned resource state.
   *
   * @param atlas - The text pass's atlas.
   * @param requester - Its asynchronous glyph source.
   */
  constructor(atlas: GlyphAtlas, requester: GlyphRequester) {
    this.glyphs = new SharedGlyphQuads(atlas, requester);
  }

  /**
   * Retires full-glyph reuse before the next frame; Greek bars have no atlas state and make no
   * lookups.
   *
   * @param sink - The frame's counters, which take its glyph lookups and misses.
   */
  beginFrame(sink?: GlyphLookupSink): void {
    this.glyphs.beginFrame(sink);
  }

  /**
   * Builds local geometry with the entry's exact tier history.
   *
   * @param entry - Previous geometry and tier choices.
   * @param layout - Immutable completed layout.
   * @param isGreek - Whether to draw bars instead of glyphs.
   * @param scale - Device pixels per world unit.
   * @param vector - The vector tier's geometry, when the pass draws it.
   * @returns Ordered local quads and completeness: the glyphs, then any link underlines,
   *   then any underlines and strikethroughs and list markers' glyphs, in full form.
   */
  get(
    entry: TextObjectEntry,
    layout: TextLayout,
    isGreek: boolean,
    scale: number,
    vector?: VectorGlyphPolicy,
  ): OrderedGlyphQuads {
    const origin = textOriginOf(entry.geometry, layout);
    if (isGreek) return this.greek.get(layout, origin);
    const placement = { originX: origin.x, originY: origin.y, scale };
    const previousTiers =
      entry.builtLayout === layout && !entry.isGreek ? entry.quads?.tiers : undefined;
    const glyphs = this.glyphs.get(
      layout,
      previousTiers === undefined ? placement : { ...placement, previousTiers },
      vector,
    );
    // Link underlines, decorations and list markers follow the glyphs, so
    // record `i` is still glyph `i`.
    const underlines = linkUnderlineQuads(layout, origin, scale).quads;
    const decorations = decorationQuads(layout, origin, scale);
    const markerLayout = markerLayoutOf(layout);
    const markers =
      markerLayout === undefined
        ? undefined
        : this.glyphs.get(
            markerLayout,
            previousTiers === undefined ? placement : { ...placement, previousTiers },
          );
    if (underlines.length === 0 && decorations.length === 0 && markers === undefined) return glyphs;
    return {
      ...glyphs,
      quads: [...glyphs.quads, ...underlines, ...decorations, ...(markers?.quads ?? [])],
      isComplete: glyphs.isComplete && (markers?.isComplete ?? true),
    };
  }
}
