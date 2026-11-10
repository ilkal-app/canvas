import type { ObjectId } from '@canvas/schema';
import { fontFaceId } from '@canvas/text';

import type { ScenePass } from '../../scene/scene-pass.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { FontLibrary } from '../font/font-library.js';
import type { GlyphSource } from '../msdf/glyph-source.js';

import type { IncompleteText } from './text-atlas-changes.js';
import type { TextAtlasPages } from './text-atlas-pages.js';
import { fontsKeyOf, type TextLayoutCache } from './text-layout-cache.js';
import type { TextObjectEntry } from './text-object-entry.js';

const READERS = new WeakMap<
  ScenePass,
  (fontSetKey: string, candidates?: ReadonlySet<ObjectId>) => boolean
>();

/**
 * Reads only the built-in text contributor, never a complete preview certificate.
 *
 * @param pass - A pass owned by the current renderer.
 * @param fontSetKey - Expected successful immutable font catalogue.
 * @param candidates - The objects the preview holds. Text waiting off-screen for view
 *   that is not among them is left out; without them every text counts.
 * @returns False for unsupported passes or any unproven text dependency.
 */
export function isTextPreviewReady(
  pass: ScenePass,
  fontSetKey: string,
  candidates?: ReadonlySet<ObjectId>,
): boolean {
  return READERS.get(pass)?.(fontSetKey, candidates) ?? false;
}

/** Live text resources inspected only after the caller's successful frame barrier. */
export interface TextPreviewResources {
  readonly entries: ReadonlyMap<ObjectId, TextObjectEntry>;
  readonly layouts: TextLayoutCache;
  readonly atlas: GlyphAtlas;
  readonly pages: TextAtlasPages;
  readonly glyphs: GlyphSource;
  readonly landed: ReadonlySet<ObjectId>;
  /**
   * Text drawn in glyphs still waiting for one, and the part of it waiting off-screen for view,
   * rewritten once it enters view: what a preview does not hold of it is left out.
   */
  readonly incomplete: IncompleteText;
  /** Text whose level-of-detail rewrite waits for a later frame. */
  readonly detailQueue: ReadonlySet<ObjectId>;
}

/** Conservative all-text contributor; face replacement requires a fresh renderer. */
export class TextPreviewReadiness {
  private readonly observed = new Map<string, string>();
  private hasReplacement = false;

  /**
   * Registers one built-in pass; unknown/custom passes have no implicit readiness.
   *
   * @param pass - The pass being constructed.
   * @param fonts - Its font library.
   * @param resources - Live resources owned by the pass.
   * @param frameFontKey - The catalogue key last processed by the text frame stage.
   */
  constructor(
    pass: ScenePass,
    private readonly fonts: FontLibrary,
    private readonly resources: TextPreviewResources,
    private readonly frameFontKey: () => string,
  ) {
    this.observeFonts();
    READERS.set(pass, (key, candidates) => this.read(key, candidates));
  }

  /** Records replacements even before an asynchronous old glyph result can land. */
  observeFonts(): void {
    for (const face of this.fonts.faces) {
      const id = fontFaceId(face);
      const key = this.fonts.get(id)?.fontKey;
      if (key === undefined) continue;
      const previous = this.observed.get(id);
      if (previous !== undefined && previous !== key) this.hasReplacement = true;
      this.observed.set(id, key);
    }
  }

  private read(key: string, candidates: ReadonlySet<ObjectId> | undefined): boolean {
    this.observeFonts();
    const { entries, layouts, atlas, pages, glyphs, landed, incomplete, detailQueue } =
      this.resources;
    // Text waiting for view that the preview does not hold is not drawn in it.
    const isLeftOut = (id: ObjectId): boolean =>
      candidates !== undefined && !candidates.has(id) && incomplete.waitingForView.has(id);
    const frameKey = this.frameFontKey();
    if (
      this.hasReplacement ||
      this.fonts.contentIdentity !== key ||
      key === '' ||
      frameKey !== fontsKeyOf(this.fonts) ||
      !glyphs.isIdle ||
      landed.size > 0 ||
      [...incomplete.ids].some((id) => !isLeftOut(id)) ||
      detailQueue.size > 0 ||
      pages.uploadedRevision !== atlas.revision
    )
      return false;
    for (const [id, entry] of entries) {
      if (isLeftOut(id)) continue;
      if (
        entry.isStale ||
        entry.builtLayout === undefined ||
        entry.quads?.isComplete !== true ||
        !layouts.isCurrent(id, entry.geometry, frameKey, entry.builtLayout)
      )
        return false;
    }
    return true;
  }
}
