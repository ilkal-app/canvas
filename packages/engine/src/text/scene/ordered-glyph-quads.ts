import { SPACE } from '@canvas/text';
import type { LayoutRun, TextLayout } from '@canvas/text';

import type { WorldBounds } from '../../camera/camera.js';
import { unionBounds } from '../../spatial/bounds.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { glyphFaceOf, glyphKeyOf, type GlyphFace } from '../atlas/glyph-key.js';
import {
  atlasTierOf,
  BASE_TIER,
  cappedTextTier,
  pickAvailable,
  pickTextTier,
  VECTOR_TIER,
  type GlyphTier,
  type TextTier,
} from '../atlas/glyph-tiers.js';
import type { GlyphQuad } from '../renderer/glyph-instance.js';
import type { GlyphPlacement, GlyphRequester } from '../renderer/glyph-quads.js';

/** A drawn glyph's quad and the atlas page it samples. */
export interface PagedGlyphQuad {
  /** The quad, in the placement's frame. */
  readonly quad: GlyphQuad;
  /** The atlas page. */
  readonly pageId: number;
}

/** Glyph lookups and the misses among them, counted as quads are built. */
export interface GlyphLookupCounts {
  /** One per glyph that is not a space. */
  lookups: number;
  /** Glyphs not found at the tier wanted, so requested. */
  misses: number;
}

/** A text box's glyph quads in glyph order, one slot per drawable glyph. */
export interface OrderedGlyphQuads {
  /**
   * One entry per glyph that is not a space, in layout order: its quad, or `undefined` while no
   * tier of it is in the atlas (it draws nothing until it lands).
   */
  readonly quads: readonly (PagedGlyphQuad | undefined)[];
  /** The tier each run wanted: pass them back as `previousTiers` next time. */
  readonly tiers: readonly TextTier[];
  /** The atlas's highest tier the tiers were capped at (`GlyphAtlas.maxTier`), if any. */
  readonly maxTier?: GlyphTier;
  /** Whether every glyph drew at the tier it wanted (a vector run waiting for geometry did not). */
  readonly isComplete: boolean;
  /**
   * The runs drawn from their outlines, ascending: their glyphs have no quads here, and
   * the text pass's vector companion draws them. Empty without a {@link VectorGlyphPolicy}.
   */
  readonly vectorRuns: readonly number[];
  /**
   * Where the glyphs of `vectorRuns` reach, in the placement's frame: their drawing bounds, as
   * the quads' are for the rest; absent without any.
   */
  readonly vectorBounds?: WorldBounds | undefined;
}

/** No run drawn from its outlines. */
const NO_VECTOR_RUNS: VectorRuns = { runs: [], bounds: undefined };

/** What the vector glyph tier tells a text box's quads. */
export interface VectorGlyphPolicy {
  /** Changes whenever a run's readiness can change: geometry landed, evicted or dropped. */
  readonly revision: number;
  /**
   * Whether every glyph of a run has its geometry, asking for what is missing: a run at the vector
   * tier draws from its outlines only then, and from the atlas until then.
   *
   * @param layout - The laid-out text.
   * @param run - The run: an index into `layout.runs`.
   * @param face - The run's face, at its coordinates.
   * @returns Whether the run's geometry is all there.
   */
  isRunReady(layout: TextLayout, run: number, face: GlyphFace): boolean;
}

/**
 * Builds a laid-out text box's glyph quads in glyph order, the way `buildGlyphQuads` builds them
 * by page (the prototype's `TextRenderer.addText`): each run picks its tier from its on-screen
 * em size with hysteresis, each glyph draws from that tier or, while it is missing, from the
 * highest lower tier that has it, and missing glyphs are requested. The scene's text pass keeps
 * one instance record per glyph that is not a space, so glyph `i` here is record `i`. With a
 * vector policy a run may pick the vector tier: it draws from the 512 tier until all its
 * geometry is ready and all its glyphs are in the atlas, none a colour glyph (an emoji is drawn
 * from its bitmap, never filled as an outline); then, as a unit, its glyphs have no quads and it
 * is listed in `vectorRuns`. Pure but for the atlas's use marks and the requests.
 *
 * @param layout - The laid-out text.
 * @param placement - Where the box is, in the object's frame, and its device px per world unit.
 * @param atlas - The glyph atlas; its highest tier caps the runs' tiers.
 * @param requester - Where to ask for missing glyphs.
 * @param counts - Counts each glyph's lookup and miss, when given.
 * @param vector - The vector tier's geometry, when the pass draws it.
 * @returns The quads in glyph order, the runs' tiers, whether all are at their tier, and the runs
 *   drawn from their outlines.
 */
export function orderedGlyphQuads(
  layout: TextLayout,
  placement: GlyphPlacement,
  atlas: Pick<GlyphAtlas, 'lookup' | 'maxTier'>,
  requester?: GlyphRequester,
  counts?: GlyphLookupCounts,
  vector?: VectorGlyphPolicy,
): OrderedGlyphQuads {
  // Atlas tiers are capped at the atlas's highest tier: a glyph above it would never fit a page.
  // The vector tier is not the atlas's, and draws from that highest tier meanwhile.
  const { maxTier } = atlas;
  const options = { isVectorEnabled: vector !== undefined };
  const tiers = layout.runs.map((run, index) =>
    cappedTextTier(
      pickTextTier(run.fontSize * placement.scale, placement.previousTiers?.[index], options),
      maxTier,
    ),
  );
  // Each run's glyphs are keyed by its instance: its face at its coordinates.
  const instances = layout.runs.map((run) => ({ run, face: glyphFaceOf(run) }));
  const vectorDrawn =
    vector === undefined
      ? NO_VECTOR_RUNS
      : readyVectorRuns(layout, placement, tiers, instances, atlas, vector, maxTier, counts);
  const vectorRuns = vectorDrawn.runs;
  const quads: (PagedGlyphQuad | undefined)[] = [];
  let isComplete = true;
  for (const glyph of layout.glyphs) {
    if (glyph.codepoint === SPACE) continue;
    if (vectorRuns.includes(glyph.run)) {
      quads.push(undefined);
      continue;
    }
    const instance = instances[glyph.run];
    const run = instance?.run;
    const wanted = tiers[glyph.run] ?? BASE_TIER;
    // A vector run still waiting for its geometry draws from the atlas tier under it.
    const tier = atlasTierOf(wanted, maxTier);
    if (wanted === VECTOR_TIER) isComplete = false;
    // A shaped glyph (a ligature, a conjunct) by its glyph id; any other by its codepoint.
    const key = glyphKeyOf(glyph);
    const picked =
      instance && pickAvailable(tier, (candidate) => atlas.lookup(instance.face, key, candidate));
    if (counts !== undefined) counts.lookups += 1;
    if (run && picked?.tier !== tier) {
      if (counts !== undefined) counts.misses += 1;
      isComplete = false;
      requester?.request(run, key, tier);
      if (picked === undefined && tier !== BASE_TIER) {
        requester?.request(run, key, BASE_TIER);
      }
    }
    const entry = picked?.entry;
    if (run === undefined || picked === undefined || entry?.pageId === undefined) {
      quads.push(undefined);
      continue;
    }
    const scale = run.fontSize / picked.tier;
    quads.push({
      pageId: entry.pageId,
      quad: {
        x: placement.originX + glyph.x + entry.left * scale,
        y: placement.originY + glyph.y - entry.top * scale,
        width: entry.width * scale,
        height: entry.height * scale,
        u0: entry.u0,
        v0: entry.v0,
        u1: entry.u1,
        v1: entry.v1,
        color: run.color,
      },
    });
  }
  return { quads, tiers, isComplete, vectorRuns, vectorBounds: vectorDrawn.bounds, maxTier };
}

/** The runs drawn from their outlines, and where their glyphs reach. */
interface VectorRuns {
  readonly runs: number[];
  readonly bounds: WorldBounds | undefined;
}

/**
 * The runs at the vector tier that draw from their outlines: every glyph's geometry ready and
 * every glyph in the atlas at the tier under it, none a colour glyph; and the union of those
 * glyphs' 512-tier quads, which reach past their outlines (a distance field's padding), so the
 * text's drawing bounds still hold what the companion draws.
 *
 * @param layout - The laid-out text.
 * @param placement - Where the box is, in the object's frame.
 * @param tiers - The runs' tiers.
 * @param instances - The runs with their face strings.
 * @param atlas - The glyph atlas.
 * @param vector - The vector tier's geometry.
 * @param maxTier - The atlas's highest tier, which vector runs fall back to; none, the 512 tier.
 * @param counts - Counts each glyph's lookup, when given: a run drawn from its outlines here, a
 *   run left to the atlas by the caller.
 * @returns The runs, ascending, and their glyphs' bounds.
 */
function readyVectorRuns(
  layout: TextLayout,
  placement: GlyphPlacement,
  tiers: readonly TextTier[],
  instances: readonly { readonly run: LayoutRun; readonly face: string }[],
  atlas: Pick<GlyphAtlas, 'lookup'>,
  vector: VectorGlyphPolicy,
  maxTier: GlyphTier | undefined,
  counts: GlyphLookupCounts | undefined,
): VectorRuns {
  const fallback = atlasTierOf(VECTOR_TIER, maxTier);
  const runs: number[] = [];
  let bounds: WorldBounds | undefined;
  instances.forEach(({ run: style, face }, run) => {
    if (tiers[run] !== VECTOR_TIER || !vector.isRunReady(layout, run, style)) return;
    const scale = style.fontSize / fallback;
    let reach: WorldBounds | undefined;
    let looked = 0;
    for (const glyph of layout.glyphs) {
      if (glyph.run !== run || glyph.codepoint === SPACE) continue;
      looked += 1;
      const entry = atlas.lookup(face, glyphKeyOf(glyph), fallback);
      if (entry === undefined || entry.field === 'colour') return;
      const x = placement.originX + glyph.x + entry.left * scale;
      const y = placement.originY + glyph.y - entry.top * scale;
      const quad = {
        minX: x,
        minY: y,
        maxX: x + entry.width * scale,
        maxY: y + entry.height * scale,
      };
      reach = reach === undefined ? quad : unionBounds(reach, quad);
    }
    runs.push(run);
    // Its glyphs were each looked up once, here ('s counts): never missed, since they draw.
    if (counts !== undefined) counts.lookups += looked;
    if (reach !== undefined) bounds = bounds === undefined ? reach : unionBounds(bounds, reach);
  });
  return { runs, bounds };
}
