import { SPACE } from '@canvas/text';
import type { TextLayout } from '@canvas/text';

import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { cappedTier } from '../atlas/glyph-cell.js';
import { glyphFaceOf, glyphKeyOf, type GlyphFace, type GlyphKey } from '../atlas/glyph-key.js';
import {
  atlasTierOf,
  BASE_TIER,
  pickAvailable,
  pickTextTier,
  type GlyphTier,
  type TextTier,
} from '../atlas/glyph-tiers.js';

import type { GlyphQuad } from './glyph-instance.js';

/** Where a laid-out text box is drawn and at what scale. */
export interface GlyphPlacement {
  /** The box's left edge, in world units. */
  readonly originX: number;
  /** The box's top edge, in world units. */
  readonly originY: number;
  /** Device px per world unit (zoom × device pixel ratio): picks each run's tier. */
  readonly scale: number;
  /**
   * The tiers the runs were drawn with last time, for tier hysteresis: the
   * vector tier among them for the scene's text pass, which this builder draws from the
   * atlas tier under it.
   */
  readonly previousTiers?: readonly TextTier[];
}

/** Something that generates missing glyphs, such as a `GlyphSource`. */
export interface GlyphRequester {
  /**
   * Asks for a glyph to be generated into the atlas, under the face's `glyphFaceOf` string.
   *
   * @param face - The face, at its run's variable-font coordinates.
   * @param glyph - The glyph's key: its codepoint, or a shaped glyph's id ({@link GlyphKey}).
   * @param tier - Texels per em.
   */
  request(face: GlyphFace, glyph: GlyphKey, tier: GlyphTier): void;
}

/** A text box's glyph quads, grouped by atlas page (one draw per page). */
export interface GlyphQuads {
  /** The quads, by page id, in layout order. */
  readonly quadsByPage: ReadonlyMap<number, readonly GlyphQuad[]>;
  /** The tier each run wanted: pass them back as `previousTiers` next time. */
  readonly tiers: readonly GlyphTier[];
  /**
   * Whether every glyph drew at the tier it wanted. When not, some drew from a lower tier or
   * not at all while generation runs: rebuild once the atlas's revision changes.
   */
  readonly isComplete: boolean;
}

/**
 * Builds the glyph quads of a laid-out text box (the prototype's `TextRenderer.addText`,
 * `src/render/textRenderer.ts`). Each run picks its tier from its on-screen em size; each glyph
 * draws from that tier's atlas entry or, while it is missing, from the highest lower tier that
 * has one (the tier cascade), and missing glyphs are requested. A glyph with no entry at any
 * tier is also requested at the base tier, which generates fastest. Spaces draw nothing.
 *
 * @param layout - The laid-out text.
 * @param placement - Where the box is and the scale it is drawn at.
 * @param atlas - The glyph atlas; lookups mark glyphs used this frame.
 * @param requester - Where to ask for missing glyphs; none when omitted.
 * @returns The quads by page, the runs' tiers, and whether every glyph was at its tier.
 */
export function buildGlyphQuads(
  layout: TextLayout,
  placement: GlyphPlacement,
  atlas: GlyphAtlas,
  requester?: GlyphRequester,
): GlyphQuads {
  // Capped at the atlas's highest tier: a glyph above it would never fit a page.
  const tiers = layout.runs.map((run, index) =>
    cappedTier(
      atlasTierOf(pickTextTier(run.fontSize * placement.scale, placement.previousTiers?.[index])),
      atlas.maxTier,
    ),
  );
  // Each run's glyphs are keyed by its instance: its face at its coordinates.
  const runs = layout.runs.map((run) => ({ run, face: glyphFaceOf(run) }));
  const quadsByPage = new Map<number, GlyphQuad[]>();
  let isComplete = true;
  for (const glyph of layout.glyphs) {
    const instance = runs[glyph.run];
    const tier = tiers[glyph.run] ?? BASE_TIER;
    if (instance === undefined || glyph.codepoint === SPACE) continue;
    const { run, face } = instance;
    const key = glyphKeyOf(glyph);
    const picked = pickAvailable(tier, (candidate) => atlas.lookup(face, key, candidate));
    if (picked?.tier !== tier) {
      isComplete = false;
      requester?.request(run, key, tier);
      if (picked === undefined && tier !== BASE_TIER) {
        requester?.request(run, key, BASE_TIER);
      }
    }
    const entry = picked?.entry;
    const pageId = entry?.pageId;
    if (picked === undefined || entry === undefined || pageId === undefined) continue;
    const scale = run.fontSize / picked.tier;
    const quad: GlyphQuad = {
      x: placement.originX + glyph.x + entry.left * scale,
      y: placement.originY + glyph.y - entry.top * scale,
      width: entry.width * scale,
      height: entry.height * scale,
      u0: entry.u0,
      v0: entry.v0,
      u1: entry.u1,
      v1: entry.v1,
      color: run.color,
    };
    const quads = quadsByPage.get(pageId);
    if (quads === undefined) quadsByPage.set(pageId, [quad]);
    else quads.push(quad);
  }
  return { quadsByPage, tiers, isComplete };
}
