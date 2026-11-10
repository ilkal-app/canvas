import type { DecorationMetrics } from './decoration-metrics.js';
import type { FontFaceKey } from './font-face.js';
import type { ParsedFont } from './parse-font.js';

/**
 * The metrics layout needs from one face, as plain structured-cloneable data: the payload of a
 * `layout` job. Lengths are in em; a run scales
 * them by its font size. Entries are sorted by codepoint.
 */
export interface FontMetrics extends DecorationMetrics {
  /** The face these metrics describe. */
  readonly face: FontFaceKey;
  /** Height above the baseline, in em. */
  readonly ascent: number;
  /** Depth below the baseline, in em, positive. */
  readonly descent: number;
  /** The advance of a character the face does not map (its `.notdef` glyph), in em. */
  readonly missingAdvance: number;
  /** `[codepoint, advance in em]` for every listed character, ascending by codepoint. */
  readonly advances: readonly (readonly [codepoint: number, advance: number])[];
  /** `[left, right, adjustment in em]` for every kerned character pair, sorted by pair. */
  readonly kerning: readonly (readonly [left: number, right: number, adjustment: number])[];
}

/**
 * Builds a face's full metrics table from its parsed font. Kerning is read per glyph pair and
 * listed per codepoint pair, since layout walks codepoints.
 *
 * @param face - The face the font was loaded as.
 * @param font - The parsed font.
 * @returns Advances of every mapped codepoint and every kerned codepoint pair.
 */
export function createFontMetrics(face: FontFaceKey, font: ParsedFont): FontMetrics {
  const characters = font.characterMap();
  const codepointsOfGlyph = new Map<number, number[]>();
  for (const [codepoint, glyphId] of characters) {
    const codepoints = codepointsOfGlyph.get(glyphId);
    if (codepoints === undefined) codepointsOfGlyph.set(glyphId, [codepoint]);
    else codepoints.push(codepoint);
  }
  const kerning: [number, number, number][] = [];
  for (const [leftGlyph, rightGlyph, adjustment] of font.kerningPairs()) {
    for (const left of codepointsOfGlyph.get(leftGlyph) ?? []) {
      for (const right of codepointsOfGlyph.get(rightGlyph) ?? []) {
        kerning.push([left, right, adjustment]);
      }
    }
  }
  kerning.sort(([leftA, rightA], [leftB, rightB]) => leftA - leftB || rightA - rightB);
  return {
    face,
    ascent: font.ascent,
    descent: font.descent,
    ...font.decoration,
    missingAdvance: font.advanceOf(0),
    advances: characters.map(([codepoint, glyphId]) => [codepoint, font.advanceOf(glyphId)]),
    kerning,
  };
}

/**
 * Cuts a face's metrics down to some codepoints, so a `layout` job carries only what its text
 * uses rather than the whole face. The input is not changed.
 *
 * @param metrics - The face's metrics (full or already a subset).
 * @param codepoints - The codepoints to keep; ones the face does not list are skipped.
 * @returns Metrics listing only those codepoints and the kerning pairs between them.
 */
export function subsetFontMetrics(metrics: FontMetrics, codepoints: Iterable<number>): FontMetrics {
  const wanted = new Set(codepoints);
  // A request may contain unknown values; NaN must not disrupt the numeric sort.
  const ordered = [...wanted].filter((point) => !Number.isNaN(point)).sort((a, b) => a - b);
  return {
    ...metrics,
    advances: selectedRows(metrics.advances, ordered, () => true),
    kerning: selectedRows(metrics.kerning, ordered, ([, right]) => wanted.has(right)),
  };
}

/**
 * Visits only rows whose first codepoint is requested, preserving sorted order and duplicates.
 * FontMetrics tables are sorted; short labels must not scan the whole font.
 *
 * @param rows - Sorted rows, never changed.
 * @param points - Unique requested codepoints in ascending order.
 * @param accepts - Whether a matching row belongs in the result.
 * @returns Selected original row references, in their original order.
 */
function selectedRows<Row extends readonly [number, ...number[]]>(
  rows: readonly Row[],
  points: readonly number[],
  accepts: (row: Row) => boolean,
): Row[] {
  const selected: Row[] = [];
  for (const point of points) {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if ((rows[middle]?.[0] ?? Infinity) < point) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < rows.length; index += 1) {
      const row = rows[index];
      if (row?.[0] !== point) break;
      if (accepts(row)) selected.push(row);
    }
  }
  return selected;
}

/** Codepoints stop at U+10FFFF, so `left × 0x110000 + right` is unique and exact. */
const CODEPOINT_SPAN = 0x110000;

/**
 * Constant-time lookups over a {@link FontMetrics} table, built once per layout: advances by
 * codepoint and kerning by codepoint pair.
 */
export class FontMetricsLookup {
  private readonly advances: Map<number, number>;
  private readonly kernings = new Map<number, number>();
  private readonly missingAdvance: number;

  /**
   * Indexes a metrics table.
   *
   * @param metrics - The table; it is read, not kept.
   */
  constructor(metrics: FontMetrics) {
    this.advances = new Map(metrics.advances);
    this.missingAdvance = metrics.missingAdvance;
    for (const [left, right, adjustment] of metrics.kerning) {
      this.kernings.set(left * CODEPOINT_SPAN + right, adjustment);
    }
  }

  /**
   * A character's advance width.
   *
   * @param codepoint - The character.
   * @returns Its advance in em; the `.notdef` advance when the table does not list it.
   */
  advance(codepoint: number): number {
    return this.advances.get(codepoint) ?? this.missingAdvance;
  }

  /**
   * The kerning between two characters set side by side.
   *
   * @param left - The character on the left.
   * @param right - The character on the right.
   * @returns The adjustment in em; 0 when the pair is not kerned.
   */
  kerning(left: number, right: number): number {
    return this.kernings.get(left * CODEPOINT_SPAN + right) ?? 0;
  }
}
