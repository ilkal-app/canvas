import type { TextLayout } from '@canvas/text';

import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphFace, GlyphKey } from '../atlas/glyph-key.js';
import type { GlyphTier } from '../atlas/glyph-tiers.js';
import type { GlyphPlacement, GlyphRequester } from '../renderer/glyph-quads.js';

import {
  orderedGlyphQuads,
  type GlyphLookupCounts,
  type OrderedGlyphQuads,
  type VectorGlyphPolicy,
} from './ordered-glyph-quads.js';

/** Where a frame's glyph lookups and misses are counted: its statistics (`FrameStats`). */
export interface GlyphLookupSink {
  /** Glyph lookups this frame. */
  atlasLookups: number;
  /** Lookups that missed the tier wanted. */
  atlasMisses: number;
}

type Effect =
  | readonly [kind: 'lookup', face: string, glyph: GlyphKey, tier: GlyphTier]
  | readonly [kind: 'request', face: GlyphFace, glyph: GlyphKey, tier: GlyphTier];
interface Entry {
  readonly placement: GlyphPlacement;
  readonly revision: number;
  /** The vector policy's revision the quads were built at; none without one. */
  readonly vectorRevision: number | undefined;
  readonly effects: readonly Effect[];
  readonly quads: OrderedGlyphQuads;
  readonly counts: Readonly<GlyphLookupCounts>;
}

/** Frame-local geometry reuse; lookup replay preserves atlas LRU and request ordering. */
export class SharedGlyphQuads {
  private entries = new WeakMap<TextLayout, Entry>();
  private sink: GlyphLookupSink = { atlasLookups: 0, atlasMisses: 0 };

  /**
   * Uses the text pass's private atlas and asynchronous glyph source.
   *
   * @param atlas - Renderer-owned atlas; lookups cannot change its revision.
   * @param requester - Renderer-owned source; requests only queue asynchronous work.
   */
  constructor(
    private readonly atlas: GlyphAtlas,
    private readonly requester: GlyphRequester,
  ) {}

  /**
   * Discards all geometry before the next frame's atlas use marks, and counts the frame's glyph
   * lookups and misses into its statistics, replays included.
   *
   * @param sink - The frame's counters; none to count nowhere.
   */
  beginFrame(sink: GlyphLookupSink = { atlasLookups: 0, atlasMisses: 0 }): void {
    this.sink = sink;
    this.entries = new WeakMap();
  }

  /**
   * Reuses only immutable local glyph geometry with identical tier history.
   *
   * @param layout - Immutable shared layout.
   * @param placement - Exact local origin, scale and prior tier choices.
   * @param vector - The vector tier's geometry, when the pass draws it: quads are
   *   reused only at the same revision of it.
   * @returns The ordinary builder's geometry and completeness.
   */
  get(
    layout: TextLayout,
    placement: GlyphPlacement,
    vector?: VectorGlyphPolicy,
  ): OrderedGlyphQuads {
    const previous = this.entries.get(layout);
    const vectorRevision = vector?.revision;
    if (
      previous?.revision === this.atlas.revision &&
      previous.vectorRevision === vectorRevision &&
      samePlacement(previous.placement, placement)
    ) {
      for (const effect of previous.effects) {
        if (effect[0] === 'lookup') this.atlas.lookup(effect[1], effect[2], effect[3]);
        else this.requester.request(effect[1], effect[2], effect[3]);
      }
      this.sink.atlasLookups += previous.counts.lookups;
      this.sink.atlasMisses += previous.counts.misses;
      return previous.quads;
    }
    const effects: Effect[] = [];
    const counts: GlyphLookupCounts = { lookups: 0, misses: 0 };
    const revision = this.atlas.revision;
    const quads = orderedGlyphQuads(
      layout,
      placement,
      {
        maxTier: this.atlas.maxTier,
        lookup: (face, glyph, tier) => {
          effects.push(['lookup', face, glyph, tier]);
          return this.atlas.lookup(face, glyph, tier);
        },
      },
      {
        request: (face, glyph, tier) => {
          effects.push(['request', face, glyph, tier]);
          this.requester.request(face, glyph, tier);
        },
      },
      counts,
      vector,
    );
    this.sink.atlasLookups += counts.lookups;
    this.sink.atlasMisses += counts.misses;
    if (revision === this.atlas.revision)
      this.entries.set(layout, {
        placement: {
          ...placement,
          ...(placement.previousTiers === undefined
            ? {}
            : {
                previousTiers: [...placement.previousTiers],
              }),
        },
        revision,
        vectorRevision,
        effects,
        quads,
        counts,
      });
    return quads;
  }
}

function samePlacement(a: GlyphPlacement, b: GlyphPlacement): boolean {
  return (
    Object.is(a.originX, b.originX) &&
    Object.is(a.originY, b.originY) &&
    Object.is(a.scale, b.scale) &&
    (a.previousTiers === b.previousTiers ||
      (a.previousTiers !== undefined &&
        a.previousTiers.length === b.previousTiers?.length &&
        a.previousTiers.every((tier, index) => tier === b.previousTiers?.[index])))
  );
}
