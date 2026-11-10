import type { BoardObject, ObjectId, ParagraphStyle, StyleRun } from '@canvas/schema';
import {
  codepointAt,
  expandedGlyphsOf,
  listMarkerOf,
  listOrdinalsOf,
  NEWLINE,
  SPACE,
} from '@canvas/text';

/**
 * Reads only the text drawn by the text pass; placement does not affect record allocation.
 *
 * @param object - The object.
 * @returns Its drawn text, if supported.
 */
export function drawnTextOf(object: BoardObject): string | undefined {
  if (object.type === 'text' || object.type === 'sticky') return object.text;
  return object.type === 'shape' || object.type === 'connector' ? object.label?.text : undefined;
}

/**
 * Reads the runs of the text the text pass draws, for its link underlines.
 *
 * @param object - The object.
 * @returns Its drawn text's runs, if any.
 */
export function drawnRunsOf(object: BoardObject): readonly StyleRun[] | undefined {
  if (object.type === 'text' || object.type === 'sticky') return object.runs;
  return object.type === 'shape' || object.type === 'connector' ? object.label?.runs : undefined;
}

/**
 * Reads the paragraph styles of the text the text pass draws, for its list markers.
 *
 * @param object - The object.
 * @returns Its drawn text's paragraph styles, if any.
 */
export function drawnParagraphsOf(object: BoardObject): readonly ParagraphStyle[] | undefined {
  if (object.type === 'text' || object.type === 'sticky') return object.paragraphs;
  return object.type === 'shape' || object.type === 'connector'
    ? object.label?.paragraphs
    : undefined;
}

/**
 * The non-newline codepoints of the runs a test picks, counted per run.
 *
 * @param text - The exact text.
 * @param runs - Its runs.
 * @param isCounted - Whether a run's characters count.
 * @returns The count.
 */
function countRunCharacters(
  text: string,
  runs: readonly StyleRun[],
  isCounted: (run: StyleRun) => boolean,
): number {
  let count = 0;
  let start = 0;
  for (const run of runs) {
    const end = start + run.length;
    if (isCounted(run)) {
      for (let index = start; index < end && index < text.length;) {
        const { codepoint, length } = codepointAt(text, index);
        if (codepoint !== NEWLINE) count += 1;
        index += length;
      }
    }
    start = end;
  }
  return count;
}

/**
 * The codepoints of a string.
 *
 * @param text - The string.
 * @returns How many codepoints it has.
 */
function codepointCount(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; count += 1) index += codepointAt(text, index).length;
  return count;
}

/**
 * The records a text's underlines and strikethroughs and its list markers' glyphs may
 * need: at most one bar per decorated codepoint per kind, as for a link's underline, and each
 * marker's characters (`1.`, `iv.`, a bullet), counted from the paragraph styles.
 *
 * @param text - The exact text.
 * @param runs - Its runs, if known.
 * @param paragraphs - Its paragraph styles, if any.
 * @returns The extra record count.
 */
function countListsAndDecorations(
  text: string,
  runs: readonly StyleRun[] | undefined,
  paragraphs: readonly ParagraphStyle[] | undefined,
): number {
  let count = 0;
  if (runs !== undefined) {
    count += countRunCharacters(text, runs, (run) => run.style.underline === true);
    count += countRunCharacters(text, runs, (run) => run.style.strikethrough === true);
  }
  if (paragraphs?.some((style) => style.list !== undefined) === true) {
    const ordinals = listOrdinalsOf(paragraphs);
    paragraphs.forEach((style, index) => {
      count += codepointCount(listMarkerOf(style, ordinals[index]) ?? '');
    });
  }
  return count;
}

/**
 * The records a text's link underlines may need, counted before any layout exists: at
 * most one per linked codepoint that is not a newline, since every underline spans at least one
 * linked glyph, a space inside a link included. Zero for text without links.
 *
 * @param text - The exact text.
 * @param runs - Its runs, if known.
 * @returns The extra record count.
 */
function countUnderlines(text: string, runs: readonly StyleRun[] | undefined): number {
  if (!runs?.some((run) => run.style.link !== undefined)) return 0;
  return countRunCharacters(text, runs, (run) => run.style.link !== undefined);
}

/**
 * Which stretches of a text carry a link, an underline or a strikethrough, and its list styles,
 * as a key: the record count depends on them.
 *
 * @param runs - The runs, if known.
 * @param paragraphs - The paragraph styles, if any.
 * @returns `start:length` and its marks per marked run, then the lists, or empty for none.
 */
function linkKeyOf(
  runs: readonly StyleRun[] | undefined,
  paragraphs?: readonly ParagraphStyle[],
): string {
  const parts: string[] = [];
  let start = 0;
  for (const run of runs ?? []) {
    const { link } = run.style;
    const isUnderlined = run.style.underline === true;
    const isStruckThrough = run.style.strikethrough === true;
    const marks = `${link === undefined ? '' : 'l'}${isUnderlined ? 'u' : ''}${isStruckThrough ? 's' : ''}`;
    if (marks !== '') parts.push(`${String(start)}:${String(run.length)}${marks}`);
    start += run.length;
  }
  const hasLists = paragraphs?.some((style) => style.list !== undefined) === true;
  return hasLists ? `${parts.join(',')}|${JSON.stringify(paragraphs)}` : parts.join(',');
}

/**
 * The scripts whose shaping can draw more glyphs than codepoints, and how many records
 * each codepoint gets, counted before any layout exists (the scene cannot grow them later):
 * three in the Indic and Southeast Asian scripts, where a lone split vowel sign shapes to a
 * dotted circle and two parts (Bengali, Tamil, Malayalam, Sinhala, Khmer); three for a combining
 * mark, which can split the base it sits on (Merriweather's "i" with a macron below is a dotless
 * i, a dot and the mark) and itself decompose (U+0344). One elsewhere, but for the codepoints a
 * bundled face splits (`expandedGlyphsOf`): Arabic takes its counts from there, measured in every
 * joining form, since Noto Sans Arabic draws a dotted letter's dots apart from its body (two
 * glyphs for "ب", three for "ڼ") and an undotted one whole. A layout past its records is counted
 * in `TextPass.droppedGlyphs`.
 */
const EXPANDING_SCRIPTS: readonly (readonly [first: number, last: number, records: number])[] = [
  [0x0300, 0x036f, 3], // Combining Diacritical Marks: a mark can split its base (i̱ is ı, dot,
  // mark), and one can decompose into two (U+0344, dialytika and tonos)
  [0x0483, 0x0489, 2], // Cyrillic combining marks
  [0x0591, 0x05c7, 2], // Hebrew points and accents
  [0x0900, 0x0dff, 3], // Devanagari to Sinhala
  [0x0e00, 0x0eff, 3], // Thai, Lao
  [0x0f00, 0x0fff, 3], // Tibetan
  [0x1000, 0x109f, 3], // Myanmar
  [0x1780, 0x17ff, 3], // Khmer
  [0x1ab0, 0x1aff, 3], // Combining Diacritical Marks Extended
  [0x1dc0, 0x1dff, 3], // Combining Diacritical Marks Supplement
  [0x20d0, 0x20ff, 3], // Combining Diacritical Marks for Symbols
  [0xfe20, 0xfe2f, 3], // Combining Half Marks
];

/**
 * The records a codepoint may need once shaped.
 *
 * @param codepoint - The codepoint.
 * @returns Its script's records per codepoint, or the glyphs a bundled face shapes it to.
 */
function recordsOf(codepoint: number): number {
  for (const [first, last, records] of EXPANDING_SCRIPTS) {
    if (codepoint >= first && codepoint <= last)
      return Math.max(records, expandedGlyphsOf(codepoint));
  }
  // Elsewhere a bundled face may still split a codepoint (Montserrat's "Ǆ"): the generated table.
  return expandedGlyphsOf(codepoint);
}

/**
 * Counts the records a text's glyphs may need: one per codepoint (more in a script whose shaping
 * can expand), except the space and newline excluded by glyph placement.
 *
 * @param text - The exact text.
 * @returns The allocated record count.
 */
function countText(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    if (codepoint !== SPACE && codepoint !== NEWLINE) count += recordsOf(codepoint);
    index += length;
  }
  return count;
}

/**
 * Pure record allocation for supported text, sticky, shape-label and connector-label objects.
 *
 * @param object - The object.
 * @returns One record per drawable codepoint (more in a script whose shaping can expand), and
 *   one more per linked one for its underlines, and for decorations and list markers,
 * or zero when it draws no text.
 */
export function textRecordCount(object: BoardObject): number {
  const text = drawnTextOf(object);
  if (text === undefined) return 0;
  const runs = drawnRunsOf(object);
  return (
    countText(text) +
    countUnderlines(text, runs) +
    countListsAndDecorations(text, runs, drawnParagraphsOf(object))
  );
}

/** Per-pass counts, retaining only objects with records until the scene forgets their slots. */
export class TextRecordCounts {
  private readonly byId = new Map<
    ObjectId,
    { readonly text: string; readonly links: string; readonly count: number }
  >();

  /**
   * Starts with nothing retained.
   *
   * @param textOf - The text a pass draws for an object, if any; the text pass's by default.
   * @param runsOf - Its runs, whose links add underline records; none if absent.
   * @param paragraphsOf - Its paragraph styles, whose lists add marker records; none if
   *   absent.
   */
  constructor(
    private readonly textOf: (object: BoardObject) => string | undefined = drawnTextOf,
    private readonly runsOf: (object: BoardObject) => readonly StyleRun[] | undefined = () =>
      undefined,
    private readonly paragraphsOf: (
      object: BoardObject,
    ) => readonly ParagraphStyle[] | undefined = () => undefined,
  ) {}

  /**
   * Reuses only an exact text and link match; previous/next objects with the same ID can
   * alternate.
   *
   * @param object - The current or historical object being compared.
   * @returns Its record count.
   */
  read(object: BoardObject): number {
    const text = this.textOf(object);
    if (text === undefined) {
      this.byId.delete(object.id);
      return 0;
    }
    const runs = this.runsOf(object);
    const paragraphs = this.paragraphsOf(object);
    const links = linkKeyOf(runs, paragraphs);
    const previous = this.byId.get(object.id);
    if (previous?.text === text && previous.links === links) return previous.count;
    const count =
      countText(text) +
      countUnderlines(text, runs) +
      countListsAndDecorations(text, runs, paragraphs);
    // Zero-record objects never own slots, so Scene has no slot release to notify us of.
    if (count === 0) this.byId.delete(object.id);
    else this.byId.set(object.id, { text, links, count });
    return count;
  }

  /**
   * Releases an object's retained text when its pass slots are removed.
   *
   * @param id - The removed object.
   */
  forget(id: ObjectId): void {
    this.byId.delete(id);
  }

  /** Releases all retained text when the renderer is destroyed. */
  clear(): void {
    this.byId.clear();
  }
}
