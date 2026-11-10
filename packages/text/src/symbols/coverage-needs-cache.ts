// Coverage needs kept per chunk of a text: the app asks for a draft's coverage on every
// keystroke, and reading the whole of a long draft each time cost typing-long 3 ms of input
// latency after #489. A text is cut into chunks by its own content, so an edit changes only the
// chunks it touches; each chunk's needs are kept, and the text's are put together from them in
// text order, so they are exactly `coverageNeeds`'s.

import type { FontWeight, StyleRun } from '@canvas/schema';

import { codepointAt } from '../layout/codepoints.js';
import { HAN_LANGUAGE_FAMILIES } from '../script/fallback-families.js';
import { isParagraphEnd } from '../script/run-language.js';
import { scriptOf } from '../script/script-table.js';

import {
  assembleCoverageNeeds,
  cjkNeeds,
  coverageNeeds,
  type CjkNeed,
  type CoverageNeed,
} from './coverage-needs.js';
import { scriptFamiliesOf } from './script-coverage.js';
import { SYMBOL_COVERAGE_FAMILIES, symbolCoverageFamilies } from './symbol-coverage.js';

/** Texts shorter than this are read whole: chunking them saves nothing. */
const MIN_CHUNKED_LENGTH = 512;

/** Chunks a cache keeps by default, least recently used dropped first: about 128k units. */
const DEFAULT_CAPACITY = 2048;

/** A chunk never runs longer than this, whatever its content (a text without a cut, `aaaa…`). */
const MAX_CHUNK_LENGTH = 1024;

/** Style signatures kept per chunk before they are dropped (a chunk restyled again and again). */
const MAX_SIGNATURES = 8;

/** One chunk's needs under one style and paragraph. */
interface ChunkNeeds {
  /** Its script faces, unordered. */
  readonly scriptFamilies: ReadonlySet<string>;
  /** Its symbol faces. */
  readonly symbolFamilies: readonly string[];
  /** Its CJK families' needs, in the order first met. */
  readonly cjk: ReadonlyMap<string, CjkNeed>;
}

/** What a cache keeps for a chunk's text. */
interface ChunkEntry {
  /** Whether it holds kana, which makes its whole paragraph's Han Japanese. */
  readonly hasKana: boolean;
  /** Its needs, by style signature and paragraph kana (`signatureOf`). */
  readonly needs: Map<string, ChunkNeeds>;
}

/**
 * The coverage needs of texts that change a little at a time, such as a draft being typed: what
 * `coverageNeeds` gives, read again only for the chunks of the text an edit touched.
 *
 * A text of at least 512 units is cut into chunks of about 64 units where the hash of its last
 * four units says so, never inside a surrogate pair, and after every paragraph end, so a chunk
 * lies in one paragraph and an edit moves only the cuts beside it. A chunk's needs depend on its
 * characters, its runs' languages, CJK families and weights, and whether its paragraph holds
 * kana, which is put together from its chunks.
 */
export class CoverageNeedsCache {
  private readonly chunks = new Map<string, ChunkEntry>();
  private scanned = 0;

  /**
   * An empty cache.
   *
   * @param capacity - Chunks to keep, least recently used dropped first.
   */
  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  /**
   * The characters the last `needs` read, to show how little an edit costs: each chunk not kept
   * yet is read twice (for kana, then for faces).
   *
   * @returns How many.
   */
  get scannedCodepoints(): number {
    return this.scanned;
  }

  /**
   * A text's coverage needs, as `coverageNeeds` gives them.
   *
   * @param text - Board text or an editing draft.
   * @param runs - Its runs, as `coverageNeeds` takes them.
   * @returns The needs.
   */
  needs(text: string, runs?: readonly StyleRun[]): readonly CoverageNeed[] {
    if (text.length < MIN_CHUNKED_LENGTH) {
      this.scanned = codepointCount(text, 0, text.length);
      return coverageNeeds(text, runs);
    }
    this.scanned = 0;
    const ends = chunkEnds(text);
    const entries = ends.map((end, index) => this.entry(text.slice(ends[index - 1] ?? 0, end)));
    const kana = paragraphKana(text, ends, entries);
    const pieces = runPieces(runs, ends);
    const scriptFamilies = new Set<string>();
    const symbolFamilies = new Set<string>();
    const cjk = new Map<string, { slices: Set<string>; weights: Set<FontWeight> }>();
    entries.forEach((entry, index) => {
      const chunkRuns = pieces?.[index];
      const isKana = kana[index] === true;
      const signature = signatureOf(chunkRuns, isKana);
      let needs = entry.needs.get(signature);
      if (needs === undefined) {
        const chunk = text.slice(ends[index - 1] ?? 0, ends[index]);
        needs = this.read(chunk, chunkRuns, isKana);
        if (entry.needs.size >= MAX_SIGNATURES) entry.needs.clear();
        entry.needs.set(signature, needs);
      }
      for (const family of needs.scriptFamilies) scriptFamilies.add(family);
      for (const family of needs.symbolFamilies) symbolFamilies.add(family);
      for (const [family, need] of needs.cjk) {
        let total = cjk.get(family);
        if (total === undefined) {
          total = { slices: new Set(['base']), weights: new Set() };
          cjk.set(family, total);
        }
        for (const slice of need.slices) total.slices.add(slice);
        for (const weight of need.weights) total.weights.add(weight);
      }
    });
    return assembleCoverageNeeds(
      scriptFamilies,
      SYMBOL_COVERAGE_FAMILIES.filter((family) => symbolFamilies.has(family)),
      cjk,
    );
  }

  /**
   * A chunk's entry, kept or made, as the most recently used.
   *
   * @param chunk - The chunk's text.
   * @returns Its entry.
   */
  private entry(chunk: string): ChunkEntry {
    const kept = this.chunks.get(chunk);
    if (kept !== undefined) {
      this.chunks.delete(chunk);
      this.chunks.set(chunk, kept);
      return kept;
    }
    this.scanned += codepointCount(chunk, 0, chunk.length);
    const made: ChunkEntry = { hasKana: hasKana(chunk), needs: new Map() };
    this.chunks.set(chunk, made);
    for (const oldest of this.chunks.keys()) {
      if (this.chunks.size <= this.capacity) break;
      this.chunks.delete(oldest);
    }
    return made;
  }

  /**
   * A chunk's needs under its runs and paragraph.
   *
   * @param chunk - The chunk's text.
   * @param runs - Its runs, relative to it; `undefined` when the text has none.
   * @param isKana - Whether its paragraph holds kana.
   * @returns The needs.
   */
  private read(chunk: string, runs: readonly StyleRun[] | undefined, isKana: boolean): ChunkNeeds {
    this.scanned += codepointCount(chunk, 0, chunk.length);
    const kana = { at: () => isKana };
    return {
      scriptFamilies: scriptFamiliesOf(chunk, runs, kana),
      symbolFamilies: symbolCoverageFamilies(chunk),
      cjk: cjkNeeds(chunk, runs, kana),
    };
  }
}

/**
 * Where a text's chunks end: after every paragraph end, else where the hash of the last four
 * units has its top six bits clear (about every 64 units), or after `MAX_CHUNK_LENGTH` units;
 * never between the halves of a surrogate pair. Each cut depends only on the units beside it,
 * so an edit moves only the cuts near it.
 *
 * @param text - The text.
 * @returns Each chunk's end, the last the text's length.
 */
function chunkEnds(text: string): number[] {
  const ends: number[] = [];
  let start = 0;
  let window = 0;
  for (let index = 0; index + 1 < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    window = ((window << 8) | (unit & 0xff)) >>> 0;
    const next = index + 1;
    const nextUnit = text.charCodeAt(next);
    if (nextUnit >= 0xdc00 && nextUnit <= 0xdfff) continue;
    if (
      isParagraphEnd(unit) ||
      Math.imul(window, 0x9e3779b1) >>> 26 === 0 ||
      next - start >= MAX_CHUNK_LENGTH
    ) {
      ends.push(next);
      start = next;
    }
  }
  ends.push(text.length);
  return ends;
}

/**
 * Whether each chunk's paragraph holds kana: whether any chunk of it does.
 *
 * @param text - The text.
 * @param ends - Its chunks' ends.
 * @param entries - Its chunks' entries.
 * @returns One flag per chunk.
 */
function paragraphKana(
  text: string,
  ends: readonly number[],
  entries: readonly ChunkEntry[],
): boolean[] {
  const flags: boolean[] = [];
  let first = 0;
  let isKana = false;
  ends.forEach((end, index) => {
    isKana ||= entries[index]?.hasKana === true;
    if (end === text.length || isParagraphEnd(text.charCodeAt(end - 1))) {
      for (let chunk = first; chunk <= index; chunk += 1) flags[chunk] = isKana;
      first = index + 1;
      isKana = false;
    }
  });
  return flags;
}

/**
 * Each chunk's runs, cut from the text's at the chunks' ends and made relative to each chunk.
 * Characters past the runs' end get no run, and runs past the text's end stay whole in the last
 * chunk's, as `coverageNeeds` reads them both (a run naming a CJK face there still asks for its
 * base slice).
 *
 * @param runs - The text's runs.
 * @param ends - Its chunks' ends.
 * @returns The runs per chunk; `undefined` when the text has none.
 */
function runPieces(
  runs: readonly StyleRun[] | undefined,
  ends: readonly number[],
): StyleRun[][] | undefined {
  if (runs === undefined) return undefined;
  const pieces: StyleRun[][] = [];
  const queue = runs.values();
  let current = queue.next();
  let runStart = 0;
  let start = 0;
  for (const [index, chunkEnd] of ends.entries()) {
    // The last chunk takes the runs to their end, past the text's if they go further.
    const end = index === ends.length - 1 ? Number.POSITIVE_INFINITY : chunkEnd;
    const piece: StyleRun[] = [];
    while (current.done !== true) {
      const runEnd = runStart + current.value.length;
      const from = Math.max(start, runStart);
      const to = Math.min(end, runEnd);
      if (to > from) piece.push({ length: to - from, style: current.value.style });
      if (runEnd > end) break;
      runStart = runEnd;
      current = queue.next();
    }
    pieces.push(piece);
    start = chunkEnd;
  }
  return pieces;
}

/**
 * What a chunk's needs depend on besides its characters: each run piece's length, the CJK family
 * it names, whether it is bold (above 500) and its language, and its paragraph's kana.
 *
 * @param runs - The chunk's runs; `undefined` when the text has none.
 * @param isKana - Whether its paragraph holds kana.
 * @returns The signature.
 */
function signatureOf(runs: readonly StyleRun[] | undefined, isKana: boolean): string {
  const paragraph = isKana ? 'kana' : 'plain';
  if (runs === undefined) return `${paragraph}/none`;
  const parts = runs.map(({ length, style }) => {
    const named = HAN_LANGUAGE_FAMILIES.includes(style.fontFamily) ? style.fontFamily : '';
    const weight = style.weight > 500 ? 'bold' : 'regular';
    return `${String(length)}|${named}|${weight}|${style.lang ?? ''}`;
  });
  return `${paragraph}/${parts.join('/')}`;
}

/**
 * Whether a text holds kana.
 *
 * @param text - The text.
 * @returns True when it does.
 */
function hasKana(text: string): boolean {
  for (let index = 0; index < text.length;) {
    const { codepoint, length } = codepointAt(text, index);
    const script = scriptOf(codepoint);
    if (script === 'Hira' || script === 'Kana') return true;
    index += length;
  }
  return false;
}

/**
 * How many characters a range of a text holds.
 *
 * @param text - The text.
 * @param start - The range's start.
 * @param end - Its end.
 * @returns How many codepoints.
 */
function codepointCount(text: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += codepointAt(text, index).length) count += 1;
  return count;
}
