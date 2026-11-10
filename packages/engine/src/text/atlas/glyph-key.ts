import { variationKey, type LayoutGlyph } from '@canvas/text';

/**
 * Which glyph of a face the atlas holds, a glyph request asks for, or an `msdf` job generates:
 * a codepoint (>= 0) for a glyph measured per codepoint, or `-1 - glyphId` (< 0) for
 * a glyph HarfBuzz shaped, such as a ligature or a conjunct, which has no codepoint of its own.
 * A codepoint key is the codepoint itself, so the per-codepoint path is keyed as before.
 */
export type GlyphKey = number;

/**
 * The key of a laid-out glyph.
 *
 * @param glyph - The glyph.
 * @returns Its glyph id's key when it was shaped, else its codepoint.
 */
export function glyphKeyOf(glyph: Pick<LayoutGlyph, 'codepoint' | 'glyphId'>): GlyphKey {
  return glyph.glyphId === null ? glyph.codepoint : -1 - glyph.glyphId;
}

/**
 * The glyph id a key names.
 *
 * @param key - The key.
 * @returns The glyph id of a shaped glyph's key; undefined for a codepoint.
 */
export function glyphIdOfKey(key: GlyphKey): number | undefined {
  return key < 0 ? -1 - key : undefined;
}

/**
 * A face at variable-font coordinates: a laid-out run, or the face it requests glyphs
 * of. Without coordinates, or with empty ones, it is the face's default instance.
 */
export interface GlyphFace {
  /** The face (`fontFaceId`), as the font library loads it. */
  readonly faceId: string;
  /** The normalised coordinates it is drawn at; absent for the defaults. */
  readonly variations?: Readonly<Record<string, number>>;
}

/**
 * The face string the atlas keys a face's glyphs by: its face id for the default
 * instance, so default glyphs are keyed as before, else the id and `@` and the coordinates'
 * canonical key, so each instance has glyphs of its own.
 *
 * @param face - The face and its coordinates.
 * @returns The face string.
 */
export function glyphFaceOf(face: GlyphFace): string {
  const key = variationKey(face.variations ?? {});
  return key === '' ? face.faceId : `${face.faceId}@${key}`;
}
