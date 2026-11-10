import type { BoardObject, ObjectId } from '@canvas/schema';

import type { AtlasGlyph, GlyphAtlas } from '../atlas/glyph-atlas.js';

import { OffscreenAtlasTexts } from './offscreen-atlas-texts.js';
import type { PagedGlyphQuad } from './ordered-glyph-quads.js';
import type { VisibleObjects } from './text-tier-checks.js';

/** What `TextAtlasChanges.collect` reads of a text: its detail and the quads it draws. */
export interface AtlasChangeEntry {
  /** Whether it draws as greek bars (no atlas glyphs). */
  readonly isGreek: boolean;
  /** Its glyph quads, if built. */
  readonly quads?: { readonly quads: readonly (PagedGlyphQuad | undefined)[] } | undefined;
  /** The object it draws for, where known: whether its text may wait for view. */
  readonly target?: { readonly object: BoardObject };
}

/** Whether a pass's text can draw outside its object's box: its drawing bounds. */
export interface DrawingBoundsKind {
  /**
   * Whether an object's text has drawing bounds of its own.
   *
   * @param object - The object.
   * @returns True when its text can reach past its box.
   */
  hasDrawingBounds(object: BoardObject): boolean;
}

/** A text pass's incomplete text, and which of it waits off-screen for view. */
export interface IncompleteText {
  /** Text drawn in glyphs still waiting for one. */
  readonly ids: ReadonlySet<ObjectId>;
  /** Off-screen text an atlas change made stale, rewritten once it enters view. */
  readonly waitingForView: ReadonlySet<ObjectId>;
}

/** A visible set holding everything: no text waits for view. */
const ALL_VISIBLE: VisibleObjects = {
  visibleRevision: 0,
  visibleIds: undefined,
  enteredIds: [],
  isVisible: () => true,
};

/**
 * Follows the glyph atlas for the text pass: which text an atlas change affects. Rendering thread.
 */
export class TextAtlasChanges {
  private revision = 0;
  private evictedCount = 0;
  /** The atlas's regenerations already reported. */
  private reportedRegenerations = 0;
  /**
   * The cells of the glyphs evicted since the last `collect`, by page, then `u0`, then
   * the set of `v0`: a cell is where a quad samples, so a quad on one of them may now read
   * another glyph's texels.
   */
  private readonly evicted = new Map<number, Map<number, Set<number>>>();
  private evictedCellCount = 0;
  /** Off-screen text the atlas changed for, rewritten when it comes into view. */
  private readonly offscreen = new OffscreenAtlasTexts();
  /** The text an atlas change affects, reused from call to call. */
  private readonly changed = new Set<ObjectId>();

  /**
   * The pass's incomplete text with the part of it waiting for view: off-screen text
   * an atlas change made stale, outside the frame's visible set until it enters it.
   *
   * @param incomplete - Text drawn in glyphs still waiting for one; kept, read live.
   * @returns Both sets, live.
   */
  incompleteText(incomplete: ReadonlySet<ObjectId>): IncompleteText {
    return { ids: incomplete, waitingForView: this.offscreen.waiting };
  }

  /**
   * Starts at an empty atlas, and follows its evictions (`GlyphAtlas.onEvict`).
   *
   * @param atlas - The pass's atlas.
   * @param kind - The pass's kind, for which text may wait for view; without it none waits.
   */
  constructor(
    private readonly atlas: GlyphAtlas,
    private readonly kind?: DrawingBoundsKind,
  ) {
    atlas.onEvict = (glyph) => {
      this.remember(glyph);
    };
  }

  /**
   * Marks the text an atlas change since the last call affects: after an eviction the objects
   * drawn in glyphs with a quad on an evicted glyph's cell (every object drawn in glyphs
   * when an eviction went unseen), after inserts only objects still waiting for a glyph.
   *
   * Only text in the frame's visible set is rewritten at once: off-screen text waits until it
   * comes into view (`OffscreenAtlasTexts`), since rewriting asks for its glyphs at the
   * tier of the scale now.
   *
   * @param entries - The pass's text, by object: whether it draws as greek bars, and its quads.
   * @param incomplete - Text drawn in glyphs still waiting for one.
   * @param stale - Collects the objects to rewrite.
   * @param visible - The frame's visible set; everything visible when absent.
   */
  collect(
    entries: ReadonlyMap<ObjectId, AtlasChangeEntry>,
    incomplete: ReadonlySet<ObjectId>,
    stale: Set<ObjectId>,
    visible: VisibleObjects = ALL_VISIBLE,
  ): void {
    const { changed } = this;
    changed.clear();
    this.collectChanged(entries, incomplete, changed);
    this.offscreen.take(changed, visible, stale, entries, (id) => {
      const object = entries.get(id)?.target?.object;
      return object !== undefined && this.kind?.hasDrawingBounds(object) === false;
    });
  }

  /**
   * The text an atlas change since the last call affects, visible or not.
   *
   * @param entries - The pass's text.
   * @param incomplete - Text drawn in glyphs still waiting for one.
   * @param stale - Collects the objects.
   */
  private collectChanged(
    entries: ReadonlyMap<ObjectId, AtlasChangeEntry>,
    incomplete: ReadonlySet<ObjectId>,
    stale: Set<ObjectId>,
  ): void {
    const { revision } = this.atlas;
    if (revision === this.revision) return;
    this.revision = revision;
    const { evictedGlyphCount } = this.atlas.memory();
    const isEvicted = evictedGlyphCount !== this.evictedCount;
    this.evictedCount = evictedGlyphCount;
    const hasCells = this.evictedCellCount > 0;
    if (!isEvicted && !hasCells) {
      for (const id of incomplete) stale.add(id);
      return;
    }
    for (const [id, entry] of entries) {
      if (!entry.isGreek && (!hasCells || this.drawsFromEvicted(entry))) stale.add(id);
    }
    for (const id of incomplete) stale.add(id);
    this.evicted.clear();
    this.evictedCellCount = 0;
  }

  /**
   * Forgets a text the pass forgot: it no longer waits for view.
   *
   * @param id - The text.
   */
  forget(id: ObjectId): void {
    this.offscreen.forget(id);
  }

  /**
   * The glyphs the atlas generated again soon after evicting them since the last call, for a
   * frame's statistics: glyphs land between frames, so a frame reports those landed before it.
   *
   * @returns How many.
   */
  takeRegenerations(): number {
    const regenerated = this.atlas.regeneratedGlyphCount;
    const count = regenerated - this.reportedRegenerations;
    this.reportedRegenerations = regenerated;
    return count;
  }

  /**
   * Remembers an evicted glyph's cell until the next `collect`.
   *
   * @param glyph - The glyph.
   */
  private remember(glyph: AtlasGlyph): void {
    if (glyph.pageId === undefined) return;
    let byU = this.evicted.get(glyph.pageId);
    if (byU === undefined) {
      byU = new Map();
      this.evicted.set(glyph.pageId, byU);
    }
    let vs = byU.get(glyph.u0);
    if (vs === undefined) {
      vs = new Set();
      byU.set(glyph.u0, vs);
    }
    vs.add(glyph.v0);
    this.evictedCellCount += 1;
  }

  /**
   * Whether a text draws a quad from an evicted glyph's cell.
   *
   * @param entry - The text.
   * @returns Whether one of its quads samples an evicted cell.
   */
  private drawsFromEvicted(entry: AtlasChangeEntry): boolean {
    for (const placed of entry.quads?.quads ?? []) {
      if (placed === undefined) continue;
      const vs = this.evicted.get(placed.pageId)?.get(placed.quad.u0);
      if (vs?.has(placed.quad.v0) === true) return true;
    }
    return false;
  }
}
