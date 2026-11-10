import { EXPANDING_GLYPHS } from './expanding-glyphs.js';

let byCodepoint: ReadonlyMap<number, number> | undefined;

/**
 * The most glyphs a bundled face shapes a codepoint to, alone or in a joining form:
 * two for Montserrat's "Ǆ" (D and Ž) and for a joined "ب" in Noto Sans Arabic (its body and its
 * dot), one for nearly every codepoint. A generated table, checked against the bundled files.
 *
 * @param codepoint - The codepoint.
 * @returns The glyphs: one unless a bundled face expands it.
 */
export function expandedGlyphsOf(codepoint: number): number {
  byCodepoint ??= new Map(EXPANDING_GLYPHS);
  return byCodepoint.get(codepoint) ?? 1;
}
