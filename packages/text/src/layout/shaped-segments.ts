// The segments a shaped text is cut into for line breaking: maximal stretches between
// hard breaks whose runs share a face and a size, each shaped once; and the searches the breaker
// walks them with.

import { elementAt } from '../line-break/element-at.js';
import { isLineTerminator } from '../line-break/line-breaks.js';
import type { TextDirection } from '../shaping/text-direction.js';

import type { BreakingRun } from './line-breaking.js';
import type { RunCursor } from './run-cursor.js';
import type { Cluster } from './shaped-clusters.js';

/** A stretch shaped together: one face, size and bidi level, no hard break inside. */
export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly faceId: string;
  readonly fontSize: number;
  /** Its bidi embedding level; absent for a text that is left to right throughout. */
  readonly level?: number;
  /** The variable-font coordinates it is shaped at; absent for the face's defaults. */
  readonly variations?: Readonly<Record<string, number>>;
  /** Its language, a BCP 47 tag; absent for none. */
  readonly lang?: string;
  /** Its OpenType feature settings; absent for the shaper's defaults. */
  readonly fontFeatures?: Readonly<Record<string, number>>;
}

/**
 * Splits the text into segments: maximal stretches between hard breaks whose runs share a face,
 * a font size, variable-font coordinates, a language and feature settings (their kerning group) and whose characters share a
 * bidi level.
 *
 * @param text - The text.
 * @param cursor - The style runs.
 * @param levels - Each UTF-16 index's bidi level, or `undefined` for left-to-right text.
 * @returns The segments, in order; hard breaks belong to none.
 */
export function segmentsOf(
  text: string,
  cursor: RunCursor<BreakingRun>,
  levels?: Uint8Array,
): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let group: string | undefined;
  let level: number | undefined;
  let run: BreakingRun | undefined;
  const close = (end: number) => {
    if (run !== undefined && end > start) {
      const { faceId, fontSize, variations, lang, fontFeatures } = run.run;
      segments.push({
        start,
        end,
        faceId,
        fontSize,
        ...(level === undefined ? {} : { level }),
        ...(variations === undefined ? {} : { variations }),
        ...(lang === undefined ? {} : { lang }),
        ...(fontFeatures === undefined ? {} : { fontFeatures }),
      });
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    if (isLineTerminator(text.charCodeAt(index))) {
      close(index);
      start = index + 1;
      group = undefined;
      run = undefined;
      continue;
    }
    const value = cursor.at(index).value;
    const indexLevel = levels?.[index];
    if (value.kerningGroup !== group || indexLevel !== level || run === undefined) {
      close(index);
      start = index;
      group = value.kerningGroup;
      level = indexLevel;
      run = value;
    }
  }
  close(text.length);
  return segments;
}

/**
 * The position of the first cluster starting at or after a UTF-16 index (a binary search; the
 * clusters are in logical order).
 *
 * @param clusters - The clusters.
 * @param index - The index.
 * @returns The position, or the clusters' length when every cluster starts before the index.
 */
export function positionOf(clusters: readonly Cluster[], index: number): number {
  let low = 0;
  let high = clusters.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (elementAt(clusters, middle).start < index) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The position of the segment a UTF-16 index falls in, or before.
 *
 * @param segments - The segments, in order.
 * @param index - The index.
 * @returns The position of the first segment ending after the index.
 */
export function segmentHolding(segments: readonly Segment[], index: number): number {
  let position = 0;
  for (const segment of segments) {
    if (segment.end > index) break;
    position += 1;
  }
  return position;
}

/**
 * The direction to shape a segment in: its bidi level's, or HarfBuzz's guess for a text that is
 * left to right throughout.
 *
 * @param segment - The segment.
 * @returns The direction, or `undefined` to guess.
 */
export function directionOf(segment: Segment): TextDirection | undefined {
  if (segment.level === undefined) return undefined;
  return segment.level % 2 === 1 ? 'rtl' : 'ltr';
}
