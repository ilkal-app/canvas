import { EMOJI_FAMILY } from '../script/fallback-families.js';

/**
 * The bundled symbol faces, in the order a missing character is looked for in them:
 * Noto Sans Math (arrows, mathematical operators such as ⋯) and Noto Sans Symbols 2 (dingbats
 * such as ✓, geometric shapes, miscellaneous symbols). Like the Noto script faces they are hidden
 * from the font picker and loaded only for text that needs them.
 */
export const SYMBOL_COVERAGE_FAMILIES: readonly string[] = [
  'Noto Sans Math',
  'Noto Sans Symbols 2',
  EMOJI_FAMILY,
];

/** Which symbol face to load for which characters. */
const SYMBOL_FAMILIES: readonly (readonly [RegExp, string])[] = [
  // Arrows, mathematical operators, supplemental arrows and mathematical symbols.
  [/[←-⋿⟀-⟿⤀-⫿]/u, 'Noto Sans Math'],
  // Miscellaneous technical, geometric shapes, miscellaneous symbols, dingbats, braille,
  // miscellaneous symbols and arrows.
  [/[⌀-⏿■-➿⠀-⣿⬀-⯿]/u, 'Noto Sans Symbols 2'],
  // Emoji drawn as emoji by default, and any character asking for emoji presentation (VS16):
  // not text-default characters such as the copyright sign, which every face draws.
  [/[\p{Emoji_Presentation}\uFE0F]/u, EMOJI_FAMILY],
];

/**
 * The symbol faces a text may need: one for each block of symbols it holds. A face the text's
 * own font already covers is requested anyway (the layout uses it only for characters the
 * text's font lacks), since which characters a font covers is known only once it has loaded.
 * Pure.
 *
 * @param text - Board text or an editing draft.
 * @returns The families, in {@link SYMBOL_COVERAGE_FAMILIES} order.
 */
export function symbolCoverageFamilies(text: string): readonly string[] {
  return SYMBOL_FAMILIES.filter(([pattern]) => pattern.test(text)).map(([, family]) => family);
}
