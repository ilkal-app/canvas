import type { GlyphAtlas } from '../text/atlas/glyph-atlas.js';

import type { MemoryLedger } from './memory-ledger.js';

/** The ledger owner name of the MSDF glyph atlas: its report's own category name. */
export const GLYPH_ATLAS_OWNER = 'glyph-atlas';

/** The ledger owner name of the frame-title pass's own glyph atlas. */
export const FRAME_TITLE_ATLAS_OWNER = 'frame-title-atlas';

/**
 * The ledger owner of a text pass's atlas: {@link GLYPH_ATLAS_OWNER} for the scene's text, the
 * pass's name and `-atlas` for any other (the frame titles' {@link FRAME_TITLE_ATLAS_OWNER}).
 *
 * @param passName - The text pass's name.
 * @param textPassName - The scene text pass's name.
 * @returns The owner.
 */
export function atlasOwnerOf(passName: string, textPassName: string): string {
  return passName === textPassName ? GLYPH_ATLAS_OWNER : `${passName}-atlas`;
}

/**
 * Reports a glyph atlas's resident page bytes to a ledger under `atlases` (the glyph atlas
 * pages category), by default as owner {@link GLYPH_ATLAS_OWNER}; each atlas needs an
 * owner of its own, or one report replaces the other's. The atlas's own
 * `memory()` report builds an object, so call this when the atlas may have changed (after
 * `TextRenderer.prepare`), not every frame.
 *
 * @param atlas - The glyph atlas.
 * @param ledger - The ledger to report to.
 * @param owner - The atlas's owner name in the ledger.
 */
export function reportGlyphAtlasMemory(
  atlas: Pick<GlyphAtlas, 'memory'>,
  ledger: MemoryLedger,
  owner: string = GLYPH_ATLAS_OWNER,
): void {
  ledger.set('atlases', owner, atlas.memory().residentBytes);
}
