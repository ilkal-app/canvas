import type { SfntFile } from './sfnt-file.js';

/**
 * Where a face draws its underline and strikethrough, in em, as the font's `post` and
 * `OS/2` tables give them: a position is the top of the stroke, above the baseline (an
 * underline's is negative), so the stroke's centre is `position - thickness / 2`. A field is
 * absent when the font does not give it; layout then uses its own defaults.
 */
export interface DecorationMetrics {
  /** The underline's top above the baseline (`post.underlinePosition`), negative below. */
  readonly underlinePosition?: number;
  /** The underline's thickness (`post.underlineThickness`). */
  readonly underlineThickness?: number;
  /** The strikethrough's top above the baseline (`OS/2.yStrikeoutPosition`). */
  readonly strikeoutPosition?: number;
  /** The strikethrough's thickness (`OS/2.yStrikeoutSize`). */
  readonly strikeoutThickness?: number;
}

/** The decoration metrics, in the order the bundled tables encode them. */
export const DECORATION_KEYS = [
  'underlinePosition',
  'underlineThickness',
  'strikeoutPosition',
  'strikeoutThickness',
] as const;

/** Bytes of `post` up to and including `underlineThickness`. */
const POST_DECORATION_END = 12;
/** Bytes of `OS/2` up to and including `yStrikeoutPosition`. */
const OS2_STRIKEOUT_END = 30;

/**
 * Reads a face's underline and strikethrough metrics. A missing or short table, or a thickness
 * of 0 (a font that leaves the field unset), gives no value for that line.
 *
 * @param file - The font file.
 * @param unitsPerEm - The face's units per em.
 * @returns The metrics the font gives, in em.
 */
export function readDecorationMetrics(file: SfntFile, unitsPerEm: number): DecorationMetrics {
  const post = file.hasTable('post') ? file.table('post') : undefined;
  const os2 = file.hasTable('OS/2') ? file.table('OS/2') : undefined;
  const underline =
    post !== undefined && post.byteLength >= POST_DECORATION_END && post.getInt16(10) > 0
      ? {
          underlinePosition: post.getInt16(8) / unitsPerEm,
          underlineThickness: post.getInt16(10) / unitsPerEm,
        }
      : {};
  const strikeout =
    os2 !== undefined && os2.byteLength >= OS2_STRIKEOUT_END && os2.getInt16(26) > 0
      ? {
          strikeoutPosition: os2.getInt16(28) / unitsPerEm,
          strikeoutThickness: os2.getInt16(26) / unitsPerEm,
        }
      : {};
  return { ...underline, ...strikeout };
}
