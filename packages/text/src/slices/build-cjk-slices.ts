import { parseFont } from '../font/parse-font.js';

import { cjkSlices } from './cjk-slices.js';
import type { Subsetter } from './subsetter.js';

/**
 * Cuts a CJK face into its slices (`cjkSlices` over its cmap): one font file per
 * slice that holds a character, in slice order. Each keeps the layout tables for its own glyphs;
 * since every character the faces kern or ligate with another is in `base`, no pair or ligature
 * spans two slices. Deterministic: the same face gives the same files.
 *
 * @param subsetter - The subsetter (`createSubsetter`).
 * @param family - One of the five CJK families.
 * @param font - The face's file.
 * @returns The files, by slice id.
 * @throws {RangeError} For another family.
 */
export function buildCjkSlices(
  subsetter: Subsetter,
  family: string,
  font: Uint8Array,
): ReadonlyMap<string, Uint8Array> {
  const codepoints = parseFont(font)
    .characterMap()
    .map(([codepoint]) => codepoint);
  return new Map(
    [...cjkSlices(family, codepoints)].map(([id, group]) => [id, subsetter.subset(font, group)]),
  );
}
