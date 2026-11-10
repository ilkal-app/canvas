// Clusters of shaped text: a shaped stretch's glyphs grouped by HarfBuzz cluster, in
// logical order, with what line breaking needs to know about each.

import type { ShapedGlyph, ShapedRun } from '../shaping/shaper.js';

import { SPACE } from './codepoints.js';

/** A cluster: the glyphs of a run of characters that are caret-indivisible. */
export interface Cluster {
  readonly start: number;
  readonly end: number;
  /** Its glyphs, in visual order. */
  readonly glyphs: readonly ShapedGlyph[];
  /** Its advance in px. */
  readonly width: number;
  /** Whether a line may not be cut before it without shaping again. */
  readonly isUnsafeToBreak: boolean;
  readonly isSpace: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The grapheme starts of a stretch of text. HarfBuzz may split a grapheme into clusters (the
 * Devanagari conjunct "स्ते" is [2,4) and [4,6), one grapheme [2,6)); a line is never cut inside
 * one, as the caret never stops inside one.
 *
 * @param text - The text.
 * @param start - The stretch's first UTF-16 index.
 * @param end - One past its last.
 * @returns The UTF-16 index each of its graphemes starts at.
 */
export function graphemeStarts(text: string, start: number, end: number): Set<number> {
  const starts = new Set<number>();
  for (const { index } of graphemes.segment(text.slice(start, end))) starts.add(start + index);
  return starts;
}

/**
 * Groups a shaped stretch's glyphs into clusters in logical order.
 *
 * @param text - The text.
 * @param shaped - The shaped stretch.
 * @param start - The stretch's first UTF-16 index.
 * @param end - One past the stretch's last UTF-16 index.
 * @param fontSize - The size, px.
 * @returns The clusters, in logical order.
 */
export function clustersOf(
  text: string,
  shaped: ShapedRun,
  start: number,
  end: number,
  fontSize: number,
): Cluster[] {
  // At cluster level 0 clusters are monotone: each is one stretch of the buffer, in increasing
  // order left to right and decreasing right to left, so one pass groups them.
  const groups: { start: number; glyphs: ShapedGlyph[] }[] = [];
  let group: { start: number; glyphs: ShapedGlyph[] } | undefined;
  for (const glyph of shaped.glyphs) {
    if (glyph.cluster !== group?.start) {
      group = { start: glyph.cluster, glyphs: [] };
      groups.push(group);
    }
    group.glyphs.push(glyph);
  }
  if (shaped.direction === 'rtl') groups.reverse();
  return groups.map(({ start: clusterStart, glyphs }, position): Cluster => {
    const clusterEnd = groups[position + 1]?.start ?? end;
    let width = 0;
    let isUnsafeToBreak = false;
    for (const glyph of glyphs) {
      width += glyph.advance * fontSize;
      // HarfBuzz flags the glyphs of a cluster alike.
      isUnsafeToBreak ||= glyph.isUnsafeToBreak;
    }
    const isSpace = clusterEnd - clusterStart === 1 && text.charCodeAt(clusterStart) === SPACE;
    return {
      start: clusterStart,
      end: clusterEnd,
      glyphs,
      width,
      isUnsafeToBreak,
      isSpace,
    };
  });
}
