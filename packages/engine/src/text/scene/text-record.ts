import { textPaletteOf, type ColorPalette } from '../../paint/color-palette.js';
import { resolveSceneInstanceLayout } from '../../scene/instance-layout.js';
import type { SceneObject } from '../../scene/scene-pass.js';
import type { WorldTransform } from '../../scene/world-transform.js';
import { glyphColorOf, type GlyphQuad } from '../renderer/glyph-instance.js';

import type { PagedGlyphQuad } from './ordered-glyph-quads.js';
import type { PagePlacement } from './text-atlas-pages.js';

/**
 * The text pass's instance record, 19 `float32`s (76 bytes): the object's world origin
 * (`@location(1)`) and rotation axis (`@location(2)`, cos and sin), then the glyph's bitmap
 * rectangle in the object's frame (`@location(3)`), its page rectangle (`@location(4)`), its
 * straight-alpha colour (`@location(5)`) and its page's index in its page group
 * (`@location(6)`), as `scene-text.wgsl` reads them, then the clip index and layer
 * opacity the scene writes (`resolveSceneInstanceLayout`).
 */
export const TEXT_RECORD_LAYOUT = resolveSceneInstanceLayout([
  { location: 1, format: 'float32x2' },
  { location: 2, format: 'float32x2' },
  { location: 3, format: 'float32x4' },
  { location: 4, format: 'float32x4' },
  { location: 5, format: 'float32x4' },
  { location: 6, format: 'float32' },
]);

/**
 * Writes one glyph's record, field by field (prepare runs for every changed glyph, so it
 * allocates nothing).
 *
 * @param record - The record, `TEXT_RECORD_LAYOUT.floatsPerRecord` floats, zero-filled.
 * @param transform - The object's frame to the world.
 * @param quad - The glyph's quad, in the object's frame.
 * @param palette - What a quad's `'ink'` and tokens draw as (`SceneObject.palette`). Default the
 *   light theme's built-ins.
 * @param pageIndex - The glyph page's index in its page group (`TextAtlasPages.placementOf`);
 *   default 0, as for a greek bar.
 */
export function writeTextRecord(
  record: Float32Array,
  transform: WorldTransform,
  quad: GlyphQuad,
  palette?: ColorPalette,
  pageIndex = 0,
): void {
  record[0] = transform.x;
  record[1] = transform.y;
  record[2] = transform.cos;
  record[3] = transform.sin;
  record[4] = quad.x;
  record[5] = quad.y;
  record[6] = quad.width;
  record[7] = quad.height;
  record[8] = quad.u0;
  record[9] = quad.v0;
  record[10] = quad.u1;
  record[11] = quad.v1;
  const color = glyphColorOf(quad, palette);
  record[12] = color[0];
  record[13] = color[1];
  record[14] = color[2];
  record[15] = color[3];
  record[16] = pageIndex;
}

/** Where the text pass finds a glyph page's group and index (`TextAtlasPages`). */
export interface PagePlacements {
  /** The page's group and its index in the group. */
  placementOf(pageId: number): PagePlacement;
}

/**
 * The placement a record draws from: its glyph page's; the first slot of the first
 * group for a greek bar (`u0` of -1; it samples no page) or a glyph not yet in the atlas.
 *
 * @param placed - The record's glyph quad, if any.
 * @param pages - The pass's pages.
 * @returns The group and index.
 */
function placementOfGlyph(
  placed: PagedGlyphQuad | undefined,
  pages: PagePlacements,
): PagePlacement {
  if (placed === undefined || placed.quad.u0 < 0) return { group: 0, index: 0 };
  return pages.placementOf(placed.pageId);
}

/**
 * The page group a record draws in: the draw list's page for it (`ScenePass.pageOf`).
 *
 * @param placed - The record's glyph quad, if any.
 * @param pages - The pass's pages.
 * @returns The group.
 */
export function placedGroup(placed: PagedGlyphQuad | undefined, pages: PagePlacements): number {
  return placementOfGlyph(placed, pages).group;
}

/**
 * Writes a record for a placed glyph with its page's index in its group, and nothing for a
 * record without one. A pass of one page per group, whose index is always 0, may write a value
 * of its own there instead (`TextPassKind.recordValueOf`: a frame's width for its title).
 *
 * @param record - The record, zero-filled.
 * @param target - The object.
 * @param placed - The record's glyph quad, if any.
 * @param pages - The pass's pages.
 * @param value - What `@location(6)` holds in place of the page's index, if anything.
 * @returns The record's page group, as `placedGroup` gives it.
 */
export function writePlacedGlyph(
  record: Float32Array,
  target: SceneObject,
  placed: PagedGlyphQuad | undefined,
  pages: PagePlacements,
  value?: number,
): number {
  const placement = placementOfGlyph(placed, pages);
  if (placed) {
    const index = value ?? placement.index;
    writeTextRecord(record, target.transform, placed.quad, textPaletteOf(target), index);
  }
  return placement.group;
}
