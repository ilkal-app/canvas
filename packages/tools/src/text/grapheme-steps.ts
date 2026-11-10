import { nextCharacterIndex, previousCharacterIndex, snapToCharacter } from './character-steps.js';

/** The grapheme segmenter, made on first use; `null` where `Intl.Segmenter` is missing. */
let segmenter: Intl.Segmenter | null | undefined;

/**
 * The grapheme segmenter of this runtime.
 *
 * @returns The segmenter, or `null` where `Intl.Segmenter` is missing.
 */
function graphemeSegmenter(): Intl.Segmenter | null {
  segmenter ??=
    typeof Intl === 'object' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  return segmenter;
}

/** A grapheme cluster: where it starts in the text and its code units. */
interface Cluster {
  readonly index: number;
  readonly segment: string;
}

/**
 * The grapheme cluster holding a position. Safari's `Segments.containing` answers a
 * position where a cluster starting with a surrogate pair begins with that cluster joined to the
 * one before it (`'a😀b'` at 1 gives `a😀`), so the caret could never step onto an emoji or a
 * flag. Both ends of its answer are still boundaries and the position's cluster is its last, so
 * segmenting just that stretch again finds it; elsewhere the stretch is one cluster and stands.
 *
 * @param found - The grapheme segmenter.
 * @param text - The text.
 * @param index - A position in the text, UTF-16 code units.
 * @returns The cluster, or undefined past the text's end.
 */
function clusterAt(found: Intl.Segmenter, text: string, index: number): Cluster | undefined {
  const stretch = found.segment(text).containing(index);
  if (stretch === undefined) return undefined;
  let last: Cluster = stretch;
  for (const part of found.segment(stretch.segment)) {
    last = { index: stretch.index + part.index, segment: part.segment };
  }
  return last;
}

/**
 * The position one grapheme cluster before another, what Backspace deletes: an emoji ZWJ
 * sequence, a flag, or a letter with its combining marks goes whole, as the browser deletes it.
 * Falls back to one code point where `Intl.Segmenter` is missing. Pure.
 *
 * @param text - The text.
 * @param index - A position between code points, UTF-16 code units.
 * @returns The position before the cluster that ends there; 0 at the start.
 */
export function previousGraphemeIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const found = graphemeSegmenter();
  if (found === null) return previousCharacterIndex(text, index);
  const last = clusterAt(found, text, index - 1);
  return last?.index ?? previousCharacterIndex(text, index);
}

/**
 * The position one grapheme cluster after another, what Delete deletes (see
 * {@link previousGraphemeIndex}). Falls back to one code point where `Intl.Segmenter` is
 * missing. Pure.
 *
 * @param text - The text.
 * @param index - A position between grapheme clusters, UTF-16 code units.
 * @returns The position after the cluster that starts there; the text's length at the end.
 */
export function nextGraphemeIndex(text: string, index: number): number {
  if (index >= text.length) return text.length;
  const found = graphemeSegmenter();
  if (found === null) return nextCharacterIndex(text, index);
  const first = clusterAt(found, text, index);
  return first === undefined ? nextCharacterIndex(text, index) : first.index + first.segment.length;
}

/**
 * Clamps a caret to the text and snaps an interior position to a grapheme boundary. Uses the
 * whole text as segmentation context: arbitrary-length combining sequences and regional
 * indicator pairs cannot be resolved from a fixed window. Falls back to code points without
 * Intl.Segmenter. Pure.
 *
 * @param text - The text.
 * @param index - A UTF-16 position.
 * @param direction - Backward for placement; forward for the end of an inserted edit.
 * @returns A boundary, unchanged when the position already is one.
 */
export function snapToGrapheme(text: string, index: number, direction: -1 | 1 = -1): number {
  const clamped = Math.max(0, Math.min(text.length, index));
  if (clamped === 0 || clamped === text.length) return clamped;
  const found = graphemeSegmenter();
  const cluster = found === null ? undefined : clusterAt(found, text, clamped);
  if (cluster === undefined) {
    const before = snapToCharacter(text, clamped);
    return direction > 0 && before < clamped ? nextCharacterIndex(text, before) : before;
  }
  if (cluster.index === clamped) return clamped;
  return direction < 0 ? cluster.index : cluster.index + cluster.segment.length;
}
