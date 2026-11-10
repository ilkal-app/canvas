import { FontMetricsLookup, type FontMetrics } from '../font/font-metrics.js';
import { codepointAt } from '../layout/codepoints.js';
import { elementAt } from '../line-break/element-at.js';
import { scriptOf } from '../script/script-table.js';

import type { ShapedGlyph, ShapedRun } from './shaper-types.js';
import type { TextDirection } from './text-direction.js';

/**
 * A character HarfBuzz keeps in the cluster before it (its default cluster level): a mark, a
 * joiner, a variation selector or an emoji modifier.
 */
const CONTINUATION = /[\p{M}\p{Grapheme_Extend}\u200D\p{Emoji_Modifier}]/u;

/**
 * A face's metrics with what pair kerning alone does not give: the ligatures its
 * default substitutions form, and the advance of a mark with no base. Lengths in em.
 */
export interface TableFontMetrics extends FontMetrics {
  /** The ligatures, each `[codepoints, advance]`; none when absent. */
  readonly ligatures?: readonly (readonly [codepoints: readonly number[], advance: number])[];
  /**
   * The advance of each mark with no base before it in the stretch shaped, where it differs from
   * its advance after a base (HarfBuzz sets a lone mark with its own spacing), each
   * `[codepoint, advance]`; none when absent.
   */
  readonly isolatedMarks?: readonly (readonly [codepoint: number, advance: number])[];
  /**
   * The advance of each character that differs in a stretch HarfBuzz shapes as Latin, Greek or
   * Cyrillic (the face's `locl` for those scripts: a proportional ellipsis, say), each
   * `[codepoint, advance]`; none when absent.
   */
  readonly latinScriptAdvances?: readonly (readonly [codepoint: number, advance: number])[];
}

/** The scripts whose stretches take a table's `latinScriptAdvances`. */
const LATIN_LIKE = new Set(['Latn', 'Grek', 'Cyrl']);

/** The scripts HarfBuzz passes over when it guesses a stretch's script. */
const UNSCRIPTED = new Set(['Zyyy', 'Zinh', 'Zzzz']);

/**
 * Whether HarfBuzz shapes a stretch as Latin, Greek or Cyrillic: its first character of a
 * script other than Common and Inherited is one of those (`hb_buffer_guess_segment_properties`).
 *
 * @param text - The text.
 * @param start - The stretch's first UTF-16 index.
 * @param end - One past its last.
 * @returns True when it does.
 */
function isLatinLike(text: string, start: number, end: number): boolean {
  for (let index = start; index < end;) {
    const { codepoint, length } = codepointAt(text, index);
    const script = scriptOf(codepoint);
    if (!UNSCRIPTED.has(script)) return LATIN_LIKE.has(script);
    index += length;
  }
  return false;
}

/** Each metrics table's Latin-stretch advances, built once. */
const latinIndex = new WeakMap<FontMetrics, ReadonlyMap<number, number>>();

/**
 * A table's advances in a Latin, Greek or Cyrillic stretch.
 *
 * @param metrics - The table.
 * @returns The advances that differ, by codepoint.
 */
function latinAdvancesOf(metrics: TableFontMetrics): ReadonlyMap<number, number> {
  let index = latinIndex.get(metrics);
  if (index === undefined) {
    index = new Map(metrics.latinScriptAdvances);
    latinIndex.set(metrics, index);
  }
  return index;
}

/** Each metrics table's ligatures by first codepoint, longest first, built once. */
const ligatureIndex = new WeakMap<
  FontMetrics,
  ReadonlyMap<number, readonly (readonly [readonly number[], number])[]>
>();

/**
 * A table's ligatures by first codepoint, longest first.
 *
 * @param metrics - The table.
 * @returns The index.
 */
function ligaturesOf(
  metrics: TableFontMetrics,
): ReadonlyMap<number, readonly (readonly [readonly number[], number])[]> {
  let index = ligatureIndex.get(metrics);
  if (index === undefined) {
    const byFirst = new Map<number, (readonly [readonly number[], number])[]>();
    for (const ligature of metrics.ligatures ?? []) {
      const first = elementAt(ligature[0], 0);
      byFirst.set(first, [...(byFirst.get(first) ?? []), ligature]);
    }
    for (const list of byFirst.values()) list.sort((a, b) => b[0].length - a[0].length);
    index = byFirst;
    ligatureIndex.set(metrics, index);
  }
  return index;
}

/**
 * The ligature that starts at an index, if any: the longest whose characters follow there.
 *
 * @param metrics - The face's table.
 * @param text - The text.
 * @param index - The UTF-16 index.
 * @param end - One past the last index it may cover.
 * @returns The ligature's UTF-16 length and advance, or `undefined`.
 */
function ligatureAt(
  metrics: TableFontMetrics,
  text: string,
  index: number,
  end: number,
): { readonly length: number; readonly advance: number } | undefined {
  const candidates = ligaturesOf(metrics).get(codepointAt(text, index).codepoint);
  for (const [codepoints, advance] of candidates ?? []) {
    let at = index;
    const isMatch = codepoints.every((expected) => {
      if (at >= end) return false;
      const { codepoint, length } = codepointAt(text, at);
      at += length;
      return codepoint === expected;
    });
    if (isMatch) return { length: at - index, advance };
  }
  return undefined;
}

/** Each metrics table's lone-mark advances, built once. */
const isolatedIndex = new WeakMap<FontMetrics, ReadonlyMap<number, number>>();

/**
 * A mark's advance with no base before it, when the table lists one.
 *
 * @param metrics - The table.
 * @param codepoint - The mark.
 * @returns The advance in em, or `undefined` when it is its advance after a base.
 */
function isolatedAdvance(metrics: TableFontMetrics, codepoint: number): number | undefined {
  let index = isolatedIndex.get(metrics);
  if (index === undefined) {
    index = new Map(metrics.isolatedMarks);
    isolatedIndex.set(metrics, index);
  }
  return index.get(codepoint);
}

/** Each metrics table's lookup, built once. */
const lookups = new WeakMap<FontMetrics, FontMetricsLookup>();

/**
 * A metrics table's lookup, built once per table.
 *
 * @param metrics - The table.
 * @returns Its lookup.
 */
function lookupOf(metrics: FontMetrics): FontMetricsLookup {
  let lookup = lookups.get(metrics);
  if (lookup === undefined) {
    lookup = new FontMetricsLookup(metrics);
    lookups.set(metrics, lookup);
  }
  return lookup;
}

/** Each metrics table's mapped codepoints, built once. */
const mapped = new WeakMap<FontMetrics, ReadonlySet<number>>();

/**
 * Whether a metrics table maps a codepoint.
 *
 * @param metrics - The table.
 * @param codepoint - The character.
 * @returns True when it lists an advance for it.
 */
function maps(metrics: FontMetrics, codepoint: number): boolean {
  let codepoints = mapped.get(metrics);
  if (codepoints === undefined) {
    codepoints = new Set(metrics.advances.map(([listed]) => listed));
    mapped.set(metrics, codepoints);
  }
  return codepoints.has(codepoint);
}

/**
 * Shapes a stretch of text from a face's metrics alone, for a face measured from a table without
 * its file (the CJK faces a server does not deploy), as HarfBuzz shapes a face
 * whose only positioning is pair kerning: one glyph per cluster (a character with the marks,
 * joiners and selectors after it), its advance the sum of the cluster's advances, the kerning
 * between a cluster's last character and the next cluster's first added to the earlier glyph.
 * Glyph ids are 1, or 0 for a cluster whose first character the face does not map; offsets are
 * 0; a cluster kerned against the one before is unsafe to break before, as HarfBuzz marks it. A ligature the table lists is one glyph of its own advance; a stretch HarfBuzz shapes as
 * Latin, Greek or Cyrillic takes the table's advances for those scripts. Pure.
 *
 * @param metrics - The face's metrics, with its ligatures.
 * @param text - The whole text.
 * @param start - The first UTF-16 index to shape.
 * @param end - One past the last.
 * @param direction - The direction to shape in; glyphs come in visual order. Left to right when
 *   absent.
 * @returns The glyphs.
 */
export function shapeWithMetrics(
  metrics: TableFontMetrics,
  text: string,
  start: number,
  end: number,
  direction: TextDirection = 'ltr',
): ShapedRun {
  const base = lookupOf(metrics);
  const latin = isLatinLike(text, start, end) ? latinAdvancesOf(metrics) : undefined;
  const lookup = {
    advance: (codepoint: number): number => latin?.get(codepoint) ?? base.advance(codepoint),
    kerning: (left: number, right: number): number => base.kerning(left, right),
  };
  const glyphs: ShapedGlyph[] = [];
  let previous: number | undefined;
  // Kerns the glyph before a new cluster against its first character; whether it did, as
  // HarfBuzz then marks the boundary unsafe to break.
  const kernBefore = (codepoint: number): boolean => {
    const last = glyphs.at(-1);
    if (last === undefined || previous === undefined) return false;
    const kerning = lookup.kerning(previous, codepoint);
    if (kerning === 0) return false;
    glyphs[glyphs.length - 1] = { ...last, advance: last.advance + kerning };
    return true;
  };
  for (let index = start; index < end;) {
    const { codepoint, length } = codepointAt(text, index);
    const last = glyphs.at(-1);
    const ligature = ligatureAt(metrics, text, index, end);
    if (
      last !== undefined &&
      previous !== undefined &&
      CONTINUATION.test(String.fromCodePoint(codepoint))
    ) {
      glyphs[glyphs.length - 1] = { ...last, advance: last.advance + lookup.advance(codepoint) };
    } else if (last === undefined && CONTINUATION.test(String.fromCodePoint(codepoint))) {
      glyphs.push({
        glyphId: maps(metrics, codepoint) ? 1 : 0,
        cluster: index,
        advance: isolatedAdvance(metrics, codepoint) ?? lookup.advance(codepoint),
        xOffset: 0,
        yOffset: 0,
        isUnsafeToBreak: false,
      });
    } else if (ligature !== undefined) {
      glyphs.push({
        glyphId: 1,
        cluster: index,
        advance: ligature.advance,
        xOffset: 0,
        yOffset: 0,
        isUnsafeToBreak: kernBefore(codepoint),
      });
      previous = codePointBefore(text, index + ligature.length);
      index += ligature.length;
      continue;
    } else {
      glyphs.push({
        glyphId: maps(metrics, codepoint) ? 1 : 0,
        cluster: index,
        advance: lookup.advance(codepoint),
        xOffset: 0,
        yOffset: 0,
        isUnsafeToBreak: kernBefore(codepoint),
      });
    }
    previous = codepoint;
    index += length;
  }
  return { direction, glyphs: direction === 'rtl' ? glyphs.reverse() : glyphs };
}

/**
 * The character that ends just before an index.
 *
 * @param text - The text.
 * @param index - The UTF-16 index.
 * @returns Its codepoint.
 */
function codePointBefore(text: string, index: number): number {
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) return text.codePointAt(index - 2) ?? low;
  return low;
}
