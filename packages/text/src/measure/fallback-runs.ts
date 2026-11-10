// Font fallback per grapheme cluster: which face draws each cluster of a text, shared by
// the engine's layout (`coverageRuns`), measurement (`coverageMeasureRuns`, `missingGlyphs`) and
// the render service, so all three agree. A cluster is never split across faces: a mark, a zero
// width joiner or a variation selector stays in its base's face, so HarfBuzz can form it.

import { withPostScriptName, type FontWeight, type StyleRun, type TextStyle } from '@canvas/schema';

import { codepointAt } from '../layout/codepoints.js';
import { elementAt } from '../line-break/element-at.js';
import { clusterScript } from '../script/cluster-script.js';
import { isEmojiPresentation, mayHoldEmoji } from '../script/emoji-presentation.js';
import { EMOJI_FAMILY, fallbackFamiliesOf } from '../script/fallback-families.js';
import { effectiveLanguage, KanaParagraphs } from '../script/run-language.js';
import { scriptOf, type ScriptCode } from '../script/script-table.js';

/** A loaded face as fallback sees it: its family, style, and which codepoints it maps. */
export interface FallbackFace {
  /** Its family. */
  readonly family: string;
  /** Its weight. */
  readonly weight: FontWeight;
  /** Whether it is italic. */
  readonly isItalic: boolean;
  /** Its PostScript name, for a named face. */
  readonly postScriptName?: string;
  /**
   * Whether it maps a codepoint to a glyph.
   *
   * @param codepoint - The codepoint.
   * @returns True when it does.
   */
  covers(codepoint: number): boolean;
}

/** One cluster of a run and the face chosen for it. */
export interface ClusterFace {
  /** Its first UTF-16 index. */
  readonly start: number;
  /** One past its last. */
  readonly end: number;
  /** The codepoints it draws: all but default-ignorables and layout characters. */
  readonly drawn: readonly number[];
  /** The face chosen, or `undefined` when the run's own face, unresolved, draws it. */
  readonly face: FallbackFace | undefined;
}

/**
 * Whether a codepoint draws no glyph of its own: ZWNJ, ZWJ, CGJ, variation selectors and tag
 * characters (default-ignorable), and tab, line feed and carriage return (layout).
 *
 * @param codepoint - The codepoint.
 * @returns True when no face needs to map it.
 */
export function isUndrawn(codepoint: number): boolean {
  return (
    codepoint === 0x09 ||
    codepoint === 0x0a ||
    codepoint === 0x0d ||
    codepoint === 0x034f ||
    codepoint === 0x200c ||
    codepoint === 0x200d ||
    (codepoint >= 0xfe00 && codepoint <= 0xfe0f) ||
    (codepoint >= 0xe0020 && codepoint <= 0xe007f) ||
    (codepoint >= 0xe0100 && codepoint <= 0xe01ef)
  );
}

/**
 * The codepoints of a stretch of text that a face must map to draw it.
 *
 * @param text - The text.
 * @param start - The stretch's first UTF-16 index.
 * @param end - One past its last.
 * @returns Its drawn codepoints, in order.
 */
function drawnCodepoints(text: string, start: number, end: number): number[] {
  const drawn: number[] = [];
  for (let index = start; index < end;) {
    const { codepoint, length } = codepointAt(text, index);
    if (!isUndrawn(codepoint)) drawn.push(codepoint);
    index += length;
  }
  return drawn;
}

/**
 * The first candidate a test accepts, one of the run's weight and slant first.
 *
 * @param candidates - The candidates, in load order.
 * @param style - The run's style.
 * @param style.weight - Its weight.
 * @param style.italic - Whether it is italic.
 * @param accepts - The test.
 * @returns The candidate, or `undefined`.
 */
function preferred(
  candidates: readonly FallbackFace[],
  style: Pick<TextStyle, 'weight' | 'italic'>,
  accepts: (face: FallbackFace) => boolean,
): FallbackFace | undefined {
  return (
    candidates.find(
      (face) => face.weight === style.weight && face.isItalic === style.italic && accepts(face),
    ) ?? candidates.find(accepts)
  );
}

/**
 * The face that draws one cluster: the run's own face when it maps every drawn codepoint; else a
 * face of the cluster's own families that does; else any face that does; else one that maps its
 * first drawn codepoint, so its base still draws; else the run's own face.
 *
 * @param run - The run.
 * @param own - The run's own face, if it resolves.
 * @param candidates - The fallback faces, in load order.
 * @param drawn - The cluster's drawn codepoints.
 * @param families - The cluster's families, tried first in order (`clusterFamilies`).
 * @returns The face, or `undefined` for the run's own face when it does not resolve.
 */
function chooseFace(
  run: StyleRun,
  own: FallbackFace | undefined,
  candidates: readonly FallbackFace[],
  drawn: readonly number[],
  families: readonly string[],
): FallbackFace | undefined {
  const mapsAll = (face: FallbackFace): boolean => drawn.every((point) => face.covers(point));
  if (drawn.length === 0 || (own !== undefined && mapsAll(own))) return own;
  const [base = 0] = drawn;
  for (const family of families) {
    const face = preferred(candidates, run.style, (it) => it.family === family && mapsAll(it));
    if (face !== undefined) return face;
  }
  return (
    preferred(candidates, run.style, mapsAll) ??
    preferred(candidates, run.style, (face) => face.covers(base)) ??
    own
  );
}

/**
 * The families a cluster's fallback tries first: the emoji face for an emoji-presentation cluster
 * (ahead of a symbol face that also maps it), then its script's families in order (a Traditional
 * Chinese face before Simplified, when loaded).
 *
 * @param segment - The cluster's text.
 * @param script - The cluster's script.
 * @param lang - The cluster's language (`effectiveLanguage`), which picks Han's face.
 * @returns The families.
 */
function clusterFamilies(
  segment: string,
  script: ScriptCode,
  lang: string | undefined,
): readonly string[] {
  const families = fallbackFamiliesOf(script, lang);
  return isEmojiPresentation(segment) ? [EMOJI_FAMILY, ...families] : families;
}

/**
 * The emoji-presentation step (ahead of the run's own face): a cluster drawn as emoji
 * goes to the emoji face, one of the run's weight and slant first, when it maps the whole cluster.
 *
 * @param run - The run.
 * @param candidates - The fallback faces, in load order.
 * @param segment - The cluster's text.
 * @param drawn - Its drawn codepoints.
 * @returns The emoji face, or `undefined` for the usual order.
 */
function emojiFace(
  run: StyleRun,
  candidates: readonly FallbackFace[],
  segment: string,
  drawn: readonly number[],
): FallbackFace | undefined {
  if (drawn.length === 0 || !isEmojiPresentation(segment)) return undefined;
  return preferred(
    candidates,
    run.style,
    (face) => face.family === EMOJI_FAMILY && drawn.every((point) => face.covers(point)),
  );
}

let segmenter: Intl.Segmenter | undefined;

/**
 * The script of a stretch's last character that is neither Common nor Inherited, which the text
 * after it carries (`clusterScript`). Read from the end, so it usually costs one lookup.
 *
 * @param drawn - The stretch's drawn codepoints.
 * @returns The script, or `undefined` when every character is Common or Inherited.
 */
function lastScript(drawn: readonly number[]): ScriptCode | undefined {
  for (let index = drawn.length - 1; index >= 0; index -= 1) {
    const script = scriptOf(elementAt(drawn, index));
    if (script !== 'Zyyy' && script !== 'Zinh') return script;
  }
  return undefined;
}

/**
 * Each run's clusters and the face that draws each, cut at run boundaries. A run its own face
 * draws whole comes as one cluster, without segmenting it.
 *
 * @param text - The text.
 * @param runs - Its stored runs, covering it.
 * @param faceOf - The face a run's style resolves to.
 * @param candidates - The fallback faces, in load order.
 * @returns For each run, its clusters.
 */
export function clusterFaces(
  text: string,
  runs: readonly StyleRun[],
  faceOf: (run: StyleRun) => FallbackFace | undefined,
  candidates: readonly FallbackFace[],
): (readonly ClusterFace[])[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const result: (readonly ClusterFace[])[] = [];
  let offset = 0;
  let previous: ScriptCode | undefined;
  const kana = new KanaParagraphs(text);
  const hasEmojiFace = candidates.some((face) => face.family === EMOJI_FAMILY);
  for (const run of runs) {
    const own = faceOf(run);
    const end = offset + run.length;
    const drawn = drawnCodepoints(text, offset, end);
    // A run may skip segmenting only when no cluster of it can go to the emoji face first.
    const isEmojiFirst = hasEmojiFace && mayHoldEmoji(text, offset, end);
    if (!isEmojiFirst && own !== undefined && drawn.every((point) => own.covers(point))) {
      result.push([{ start: offset, end, drawn, face: own }]);
      previous = lastScript(drawn) ?? previous;
      offset = end;
      continue;
    }
    const clusters: ClusterFace[] = [];
    for (const { index, segment } of segmenter.segment(text.slice(offset, end))) {
      const start = offset + index;
      const clusterEnd = start + segment.length;
      const clusterDrawn = drawnCodepoints(text, start, clusterEnd);
      const script = clusterScript(text, start, clusterEnd, previous);
      previous = script;
      const lang = script === 'Hani' ? effectiveLanguage(run.style.lang, kana, start) : undefined;
      const families = clusterFamilies(segment, script, lang);
      const face =
        (isEmojiFirst ? emojiFace(run, candidates, segment, clusterDrawn) : undefined) ??
        chooseFace(run, own, candidates, clusterDrawn, families);
      clusters.push({ start, end: clusterEnd, drawn: clusterDrawn, face });
    }
    result.push(clusters);
    offset = end;
  }
  return result;
}

/**
 * Layout runs that set each cluster in the face that draws it: a run's own face where it
 * maps the whole cluster, else a fallback face, chosen per grapheme cluster, never per codepoint.
 * The stored runs are not changed: a run its own face draws whole is returned as itself, and with
 * no fallback faces the runs come back unchanged. Pure.
 *
 * @param text - The text.
 * @param runs - Its stored runs; not mutated.
 * @param faceOf - The face a run's style resolves to, or `undefined`.
 * @param candidates - The fallback faces, in load order.
 * @returns The runs to lay out.
 */
export function fallbackRuns(
  text: string,
  runs: readonly StyleRun[],
  faceOf: (run: StyleRun) => FallbackFace | undefined,
  candidates: readonly FallbackFace[],
): readonly StyleRun[] {
  if (candidates.length === 0) return runs;
  const result: StyleRun[] = [];
  const perRun = clusterFaces(text, runs, faceOf, candidates);
  for (const [runIndex, run] of runs.entries()) {
    const own = faceOf(run);
    const pieces: StyleRun[] = [];
    for (const { start, end, face } of elementAt(perRun, runIndex)) {
      const style = face === undefined || face === own ? run.style : styleIn(run.style, face);
      const last = pieces.at(-1);
      if (
        last?.style.fontFamily === style.fontFamily &&
        last.style.postScriptName === style.postScriptName
      ) {
        pieces[pieces.length - 1] = { ...last, length: last.length + end - start };
      } else {
        pieces.push({ length: end - start, style });
      }
    }
    const [only] = pieces;
    if (only === undefined || (pieces.length === 1 && only.style === run.style)) result.push(run);
    else result.push(...pieces);
  }
  // No run needed a fallback: the stored runs themselves.
  return result.length === runs.length && result.every((run, index) => run === runs[index])
    ? runs
    : result;
}

/**
 * A run's style set in a fallback face: its family, and its name for a named face; a
 * name the run had for its own family is dropped.
 *
 * @param style - The run's style.
 * @param face - The fallback face.
 * @returns The style, or the run's own when the face is its family's plain face.
 */
function styleIn(style: StyleRun['style'], face: FallbackFace): StyleRun['style'] {
  if (face.family === style.fontFamily && face.postScriptName === style.postScriptName)
    return style;
  return withPostScriptName({ ...style, fontFamily: face.family }, face.postScriptName);
}
