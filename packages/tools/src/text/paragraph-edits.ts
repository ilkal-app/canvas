import { paragraphCount, type ParagraphStyle } from '@canvas/schema';

/** A plain paragraph: no list. */
export const PLAIN_PARAGRAPH: ParagraphStyle = Object.freeze({});

/**
 * Plain styles for every paragraph of a text.
 *
 * @param text - The text.
 * @returns One `{}` per paragraph.
 */
export function plainParagraphsOf(text: string): readonly ParagraphStyle[] {
  return Array.from({ length: paragraphCount(text) }, () => PLAIN_PARAGRAPH);
}

/**
 * The paragraph an index falls in: the number of newlines before it.
 *
 * @param text - The text.
 * @param index - A UTF-16 index in it.
 * @returns The paragraph's index.
 */
export function paragraphAt(text: string, index: number): number {
  return paragraphCount(text.slice(0, index)) - 1;
}

/**
 * Where a paragraph starts and ends, its newline excluded.
 *
 * @param text - The text.
 * @param paragraph - The paragraph's index.
 * @returns Its UTF-16 range.
 */
export function paragraphRange(
  text: string,
  paragraph: number,
): readonly [start: number, end: number] {
  let start = 0;
  for (let index = 0; index < paragraph; index += 1) start = text.indexOf('\n', start) + 1;
  const newline = text.indexOf('\n', start);
  return [start, newline < 0 ? text.length : newline];
}

/**
 * The paragraph styles after `[from, to)` of a text is replaced: the paragraph the
 * range starts in keeps its style, the paragraphs the range joins into it go, and each newline
 * inserted starts a paragraph in that same style, as rich-text editors carry a list onto the
 * next line. Pure.
 *
 * @param paragraphs - The styles before, one per paragraph of `text`.
 * @param text - The text before.
 * @param from - The range's start.
 * @param to - Its end.
 * @param inserted - What replaces it.
 * @returns The styles after, one per paragraph of the new text.
 */
export function spliceParagraphs(
  paragraphs: readonly ParagraphStyle[],
  text: string,
  from: number,
  to: number,
  inserted: string,
): readonly ParagraphStyle[] {
  const first = paragraphAt(text, from);
  const removed = paragraphCount(text.slice(from, to)) - 1;
  const added = paragraphCount(inserted) - 1;
  if (removed === 0 && added === 0) return paragraphs;
  const style = paragraphs[first] ?? PLAIN_PARAGRAPH;
  return [
    ...paragraphs.slice(0, first + 1),
    ...Array.from({ length: added }, () => style),
    ...paragraphs.slice(first + 1 + removed),
  ];
}

/**
 * The paragraphs a selection touches: the caret's paragraph when nothing is selected. A
 * selection that ends right at a paragraph's start (after the newline before it) does not touch
 * that paragraph, as in other editors.
 *
 * @param text - The text.
 * @param start - The selection's start.
 * @param end - Its end.
 * @returns The first and last paragraph indices, inclusive.
 */
export function touchedParagraphs(
  text: string,
  start: number,
  end: number,
): readonly [first: number, last: number] {
  const isAtParagraphStart = end > start && text[end - 1] === '\n';
  return [paragraphAt(text, start), paragraphAt(text, isAtParagraphStart ? end - 1 : end)];
}

/**
 * A content's paragraph styles when any paragraph is a list; `undefined` when all are
 * plain, which the document stores as none.
 *
 * @param content - The content.
 * @param content.paragraphs - Its paragraph styles, if any.
 * @returns The styles, or `undefined`.
 */
export function listParagraphsOf(content: {
  readonly paragraphs?: readonly ParagraphStyle[] | undefined;
}): readonly ParagraphStyle[] | undefined {
  const { paragraphs } = content;
  return paragraphs?.some((style) => style.list !== undefined) === true ? paragraphs : undefined;
}

/**
 * An object or content without its paragraph styles, for one whose text is replaced:
 * the old text's styles must not stay with the new text.
 *
 * @param value - The object or content.
 * @returns A copy without `paragraphs`; the input is not changed.
 */
export function withoutParagraphs<Value extends { readonly paragraphs?: unknown }>(
  value: Value,
): Value {
  const copy = { ...value };
  Reflect.deleteProperty(copy, 'paragraphs');
  return copy;
}
