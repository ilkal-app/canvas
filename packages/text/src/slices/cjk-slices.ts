import type { FontFaceKey } from '../font/font-face.js';
import { scriptOf } from '../script/script-table.js';

/** A legacy encoding's double-byte rows: the leads and trails decoded in order. */
interface LegacyRows {
  /** The WHATWG encoding label. */
  readonly encoding: string;
  /** The lead byte ranges, in order. */
  readonly leads: readonly (readonly [first: number, last: number])[];
  /** The trail byte ranges, in order. */
  readonly trails: readonly (readonly [first: number, last: number])[];
}

/**
 * A family's ideographs ranked by its legacy standard: the common level, which common text draws
 * from throughout (each standard orders it by reading or strokes, not by frequency), and the rest.
 */
interface HanRanking {
  /** The common level's rows: one slice, `han-0`; none for a family whose text rarely has any. */
  readonly common?: LegacyRows;
  /** The other rows, 500 ideographs a slice from `han-1`. */
  readonly rest: LegacyRows;
}

/** EUC rows' trail bytes, 0xA1 to 0xFE. */
const EUC_TRAIL = [[0xa1, 0xfe]] as const;

/** Big5's trail bytes. */
const BIG5_TRAIL = [
  [0x40, 0x7e],
  [0xa1, 0xfe],
] as const;

/** Big5's two levels: its 5,401 frequent ideographs (A440 to C67E), then the 7,652 others. */
const BIG5: HanRanking = {
  common: { encoding: 'big5', leads: [[0xa4, 0xc6]], trails: BIG5_TRAIL },
  rest: { encoding: 'big5', leads: [[0xc9, 0xf9]], trails: BIG5_TRAIL },
};

/** Each CJK family's ideographs ranked by its legacy standard. */
const HAN_RANKING: ReadonlyMap<string, HanRanking> = new Map([
  // GB 2312: level 1, the 3,755 common ideographs (rows B0 to D7), then level 2.
  [
    'Noto Sans SC',
    {
      common: { encoding: 'gb2312', leads: [[0xb0, 0xd7]], trails: EUC_TRAIL },
      rest: { encoding: 'gb2312', leads: [[0xd8, 0xf7]], trails: EUC_TRAIL },
    },
  ],
  ['Noto Sans TC', BIG5],
  ['Noto Sans HK', BIG5],
  // JIS X 0208: level 1, 2,965 ideographs (rows B0 to CF), then level 2.
  [
    'Noto Sans JP',
    {
      common: { encoding: 'euc-jp', leads: [[0xb0, 0xcf]], trails: EUC_TRAIL },
      rest: { encoding: 'euc-jp', leads: [[0xd0, 0xf4]], trails: EUC_TRAIL },
    },
  ],
  // KS X 1001's 4,888 Hanja, which Korean text seldom uses: no common slice.
  ['Noto Sans KR', { rest: { encoding: 'euc-kr', leads: [[0xca, 0xfd]], trails: EUC_TRAIL } }],
]);

/** KS X 1001's 2,350 Hangul syllables, the Korean face's ranked syllables. */
const HANGUL_RANKING: LegacyRows = { encoding: 'euc-kr', leads: [[0xb0, 0xc8]], trails: EUC_TRAIL };

/** Ranked ideographs per slice, past the common level. */
const HAN_SLICE = 500;
/** Codepoints per window of unranked ideographs, from U+3400. */
const HAN_WINDOW = 1024;
/** The first codepoint the unranked ideograph windows count from. */
const HAN_WINDOW_START = 0x3400;
/** Ranked Hangul syllables per slice. */
const HANGUL_SLICE = 1175;
/** Codepoints per window of unranked Hangul syllables, from U+AC00. */
const HANGUL_WINDOW = 2048;
/** The first precomposed Hangul syllable. */
const HANGUL_FIRST = 0xac00;
/** The last precomposed Hangul syllable. */
const HANGUL_LAST = 0xd7a3;

/** The part of the Encoding API this module uses: the package's `lib` is ES2022 alone. */
type LegacyDecoder = new (label: string) => { decode(bytes: Uint8Array): string };

/**
 * The platform's `TextDecoder`, which every browser and Node has (WHATWG Encoding).
 *
 * @returns Its constructor.
 */
function legacyDecoder(): LegacyDecoder {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the platform's name for it
  return (globalThis as unknown as { readonly TextDecoder: LegacyDecoder }).TextDecoder;
}

/**
 * The codepoints a legacy encoding's rows decode to, in order, each once.
 *
 * @param rows - The rows.
 * @param keep - Which codepoints to keep.
 * @returns The ranks, by codepoint.
 */
function decodeRanks(rows: LegacyRows, keep: (codepoint: number) => boolean): Map<number, number> {
  const decoder = new (legacyDecoder())(rows.encoding);
  const ranks = new Map<number, number>();
  for (const [firstLead, lastLead] of rows.leads) {
    for (let lead = firstLead; lead <= lastLead; lead += 1) {
      for (const [firstTrail, lastTrail] of rows.trails) {
        for (let trail = firstTrail; trail <= lastTrail; trail += 1) {
          const codepoint = decoder.decode(new Uint8Array([lead, trail])).codePointAt(0);
          if (codepoint !== undefined && keep(codepoint) && !ranks.has(codepoint)) {
            ranks.set(codepoint, ranks.size);
          }
        }
      }
    }
  }
  return ranks;
}

/** A family's ideographs' slices, by codepoint, decoded when first asked for. */
const hanSlices = new Map<string, ReadonlyMap<number, string>>();

/**
 * Whether a codepoint is an ideograph.
 *
 * @param codepoint - The character.
 * @returns True when its script is Han.
 */
function isIdeograph(codepoint: number): boolean {
  return scriptOf(codepoint) === 'Hani';
}

/**
 * A family's ranked ideographs' slices: its common level in `han-0`, the rest 500 a slice.
 *
 * @param ranking - The family's ranking.
 * @returns The slice of each ranked ideograph.
 */
function rankedHanSlices(ranking: HanRanking): ReadonlyMap<number, string> {
  const common =
    ranking.common === undefined
      ? new Map<number, number>()
      : decodeRanks(ranking.common, isIdeograph);
  const slices = new Map<number, string>(
    [...common.keys()].map((codepoint) => [codepoint, 'han-0']),
  );
  const first = ranking.common === undefined ? 0 : 1;
  const rest = decodeRanks(
    ranking.rest,
    (codepoint) => isIdeograph(codepoint) && !common.has(codepoint),
  );
  for (const [codepoint, rank] of rest) {
    slices.set(codepoint, `han-${String(first + Math.floor(rank / HAN_SLICE))}`);
  }
  return slices;
}
let hangulRanks: ReadonlyMap<number, number> | undefined;

/**
 * Whether a codepoint is a precomposed Hangul syllable.
 *
 * @param codepoint - The character.
 * @returns True for U+AC00 to U+D7A3.
 */
function isHangulSyllable(codepoint: number): boolean {
  return codepoint >= HANGUL_FIRST && codepoint <= HANGUL_LAST;
}

/**
 * The slice of a CJK face a character's glyph is in: `base` for every character
 * that is neither an ideograph nor a precomposed Hangul syllable (every character the faces'
 * kerning and ligatures involve among them); `han-0` for the common level of the family's legacy
 * standard (GB 2312 level 1 for Simplified Chinese, Big5's frequent ideographs for Traditional and
 * Hong Kong, JIS X 0208 level 1 for Japanese), which common text needs whole, since each standard
 * orders it by reading or strokes; `han-<n>` for the standard's other ideographs (KS X 1001's
 * Hanja for Korean), 500 a slice in its order; `han-x-<n>` for the others from U+3400 (ideographs before it, such as 〇, are in `base`), by 1,024-codepoint window from U+3400; for the Korean
 * face, `hangul-<n>` for KS X 1001's 2,350 syllables, 1,175 a slice, and `hangul-x-<n>` for the
 * others, by 2,048-codepoint window. Needs no font: a page knows which slice to fetch before it
 * has any. The rankings come from `TextDecoder`, which every browser and Node has.
 *
 * @param family - One of the five CJK families (`HAN_LANGUAGE_FAMILIES`).
 * @param codepoint - The character.
 * @returns The slice id.
 * @throws {RangeError} For another family.
 */
export function cjkSliceOf(family: string, codepoint: number): string {
  const ranking = HAN_RANKING.get(family);
  if (ranking === undefined) throw new RangeError(`${family} is not a CJK face that is sliced.`);
  if (isHangulSyllable(codepoint)) {
    if (family !== 'Noto Sans KR') return 'base';
    hangulRanks ??= decodeRanks(HANGUL_RANKING, isHangulSyllable);
    const rank = hangulRanks.get(codepoint);
    return rank === undefined
      ? `hangul-x-${String(Math.floor((codepoint - HANGUL_FIRST) / HANGUL_WINDOW))}`
      : `hangul-${String(Math.floor(rank / HANGUL_SLICE))}`;
  }
  // Ideographic marks and numerals before U+3400 (々, 〇, the Hangzhou numerals) ride with base.
  if (!isIdeograph(codepoint) || codepoint < HAN_WINDOW_START) return 'base';
  let slices = hanSlices.get(family);
  if (slices === undefined) {
    slices = rankedHanSlices(ranking);
    hanSlices.set(family, slices);
  }
  return (
    slices.get(codepoint) ??
    `han-x-${String(Math.floor((codepoint - HAN_WINDOW_START) / HAN_WINDOW))}`
  );
}

/** The order slice kinds come in. */
const KIND_ORDER = ['base', 'han', 'han-x', 'hangul', 'hangul-x'];

/**
 * A slice id's kind and number, for ordering.
 *
 * @param id - The id.
 * @returns Its kind's position and its number.
 */
function sliceOrder(id: string): readonly [number, number] {
  const dash = id.lastIndexOf('-');
  if (dash < 0) return [0, 0];
  return [KIND_ORDER.indexOf(id.slice(0, dash)), Number(id.slice(dash + 1))];
}

/**
 * A face's codepoints grouped by slice (`cjkSliceOf`): `base` first, then the ranked ideograph
 * slices, the ideograph windows, the ranked syllable slices and the syllable windows, each by
 * number, each slice's codepoints ascending. Pure.
 *
 * @param family - One of the five CJK families.
 * @param codepoints - The codepoints, such as a face's cmap.
 * @returns The slices.
 * @throws {RangeError} For another family.
 */
export function cjkSlices(
  family: string,
  codepoints: Iterable<number>,
): ReadonlyMap<string, readonly number[]> {
  const groups = new Map<string, number[]>();
  for (const codepoint of codepoints) {
    const id = cjkSliceOf(family, codepoint);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [codepoint]);
    else group.push(codepoint);
  }
  const ordered = [...groups].sort(([left], [right]) => {
    const [leftKind, leftNumber] = sliceOrder(left);
    const [rightKind, rightNumber] = sliceOrder(right);
    return leftKind - rightKind || leftNumber - rightNumber;
  });
  return new Map(ordered.map(([id, group]) => [id, group.sort((a, b) => a - b)]));
}

/** The face name that marks a slice face: `cjk-slice:` and its id. */
const SLICE_PREFIX = 'cjk-slice:';

/**
 * A CJK face's slice as a face of its own: a named face whose name is
 * `cjk-slice:<id>`, so a family's slices coexist in a font library, fallback picks the one that
 * draws a cluster and names it in the run, and layout resolves exactly that slice.
 *
 * @param face - The whole face: family, weight and slant.
 * @param id - The slice id (`cjkSliceOf`).
 * @returns The slice's face.
 */
export function cjkSliceFace(face: FontFaceKey, id: string): FontFaceKey {
  return {
    family: face.family,
    weight: face.weight,
    isItalic: face.isItalic,
    postScriptName: `${SLICE_PREFIX}${id}`,
  };
}

/**
 * The slice id of a slice face ({@link cjkSliceFace}).
 *
 * @param face - A face.
 * @returns Its slice id, or `undefined` for a face that is not a slice.
 */
export function cjkSliceIdOf(face: FontFaceKey): string | undefined {
  const name = face.postScriptName;
  return name?.startsWith(SLICE_PREFIX) === true ? name.slice(SLICE_PREFIX.length) : undefined;
}
