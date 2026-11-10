import * as Y from 'yjs';

import {
  paragraphCount,
  paragraphStyleSchema,
  type ParagraphStyle,
  type TextContent,
} from '@canvas/schema';

import { isSamePlainValue } from './plain-value.js';

/**
 * The `Y.Text` attribute that holds a paragraph's list style, on the `'\n'` that ends
 * the paragraph; a plain paragraph's newline carries none.
 */
export const PARAGRAPH_ATTRIBUTE = 'paragraph';

/**
 * The key of the last paragraph's list style, stored beside the `Y.Text` as a plain value:
 * the last paragraph has no `'\n'` to carry it. Absent for a plain last paragraph. The
 * value is a {@link LastParagraphValue}: the style and where the paragraph starts, so a restyle
 * stays with its paragraph when a peer concurrently appends a newline after it.
 */
export const LAST_PARAGRAPH_KEY = 'lastParagraph';

/**
 * What {@link LAST_PARAGRAPH_KEY} holds: the paragraph's style and its anchor, `after`: a Yjs
 * relative position (as JSON) just after the `'\n'` that starts the paragraph, `null` for a
 * paragraph that starts the text, or absent when written before the text was in a document (it
 * then means the text's last paragraph).
 */
interface LastParagraphValue {
  /** The paragraph's list style. */
  readonly style: ParagraphStyle;
  /** Where the paragraph starts; see the interface. */
  readonly after?: unknown;
}

/** A plain paragraph. */
export const PLAIN_PARAGRAPH: ParagraphStyle = Object.freeze({});

/**
 * Reads a stored paragraph style: a valid one as stored, anything else (none, or one a faulty
 * peer wrote) as a plain paragraph.
 *
 * @param value - The stored attribute or value.
 * @returns The paragraph style.
 */
function paragraphStyleOf(value: unknown): ParagraphStyle {
  if (value === undefined || value === null) return PLAIN_PARAGRAPH;
  const parsed = paragraphStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : PLAIN_PARAGRAPH;
}

/**
 * Tells whether a paragraph style is plain: no list.
 *
 * @param style - The paragraph style.
 * @returns True for a plain paragraph.
 */
function isPlainParagraph(style: ParagraphStyle): boolean {
  return style.list === undefined;
}

/**
 * The value to store for a paragraph style: a copy of a list item's, or `null` for a plain one.
 *
 * @param style - The paragraph style.
 * @returns The value, or `null`.
 */
export function storedParagraphOf(style: ParagraphStyle): ParagraphStyle | null {
  return isPlainParagraph(style) ? null : { ...style };
}

/**
 * Reads the paragraph styles carried by the newlines of a `Y.Text` delta, one per `'\n'`, in
 * order: every paragraph but the last.
 *
 * @param delta - The result of `Y.Text#toDelta()`.
 * @returns The styles.
 */
function newlineParagraphsOf(delta: readonly unknown[]): ParagraphStyle[] {
  const styles: ParagraphStyle[] = [];
  for (const op of delta) {
    const { insert, attributes } = op as {
      readonly insert?: unknown;
      readonly attributes?: Readonly<Record<string, unknown>>;
    };
    if (typeof insert !== 'string') continue;
    const style = paragraphStyleOf(attributes?.[PARAGRAPH_ATTRIBUTE]);
    for (let index = insert.indexOf('\n'); index !== -1; index = insert.indexOf('\n', index + 1)) {
      styles.push(style);
    }
  }
  return styles;
}

/**
 * The paragraph styles content asks for, one per paragraph: its `paragraphs`, or every paragraph
 * plain when it has none.
 *
 * @param content - The validated content.
 * @returns The styles.
 */
export function wantedParagraphsOf(content: TextContent): readonly ParagraphStyle[] {
  return (
    content.paragraphs ??
    Array.from({ length: paragraphCount(content.text) }, () => PLAIN_PARAGRAPH)
  );
}

/**
 * Writes each paragraph's list style: the style of every paragraph but the last as an
 * attribute on the `'\n'` that ends it, formatting only the newlines whose style changed, and the
 * last paragraph's under {@link LAST_PARAGRAPH_KEY}. The text must already hold `content.text`.
 *
 * @param host - The map that holds the rich text.
 * @param text - Its `Y.Text`.
 * @param content - The validated content.
 * @param isNew - Whether the text was just created, so it holds no paragraph attributes yet.
 */
export function writeParagraphs(
  host: Y.Map<unknown>,
  text: Y.Text,
  content: TextContent,
  isNew: boolean,
): void {
  const wanted = wantedParagraphsOf(content);
  const current = isNew ? [] : newlineParagraphsOf(text.toDelta() as unknown[]);
  let paragraph = 0;
  const characters = content.text;
  for (
    let index = characters.indexOf('\n');
    index !== -1;
    index = characters.indexOf('\n', index + 1)
  ) {
    const want = wanted[paragraph] ?? PLAIN_PARAGRAPH;
    const have = current[paragraph] ?? PLAIN_PARAGRAPH;
    if (!isSamePlainValue(storedParagraphOf(have), storedParagraphOf(want))) {
      text.format(index, 1, { [PARAGRAPH_ATTRIBUTE]: storedParagraphOf(want) });
    }
    paragraph += 1;
  }
  writeLastParagraph(host, text, characters, wanted[paragraph] ?? PLAIN_PARAGRAPH);
}

/**
 * Writes the last paragraph's style under {@link LAST_PARAGRAPH_KEY}, anchored where the paragraph
 * starts; a plain last paragraph removes the key. An unchanged style at the same anchor writes
 * nothing.
 *
 * @param host - The map that holds the rich text.
 * @param text - Its `Y.Text`, integrated in a document.
 * @param characters - The text it holds.
 * @param style - The last paragraph's style.
 */
function writeLastParagraph(
  host: Y.Map<unknown>,
  text: Y.Text,
  characters: string,
  style: ParagraphStyle,
): void {
  const stored = storedParagraphOf(style);
  if (stored === null) {
    if (host.has(LAST_PARAGRAPH_KEY)) host.delete(LAST_PARAGRAPH_KEY);
    return;
  }
  const start = characters.lastIndexOf('\n') + 1;
  const after: unknown =
    start === 0
      ? null
      : Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, start, -1));
  const value: LastParagraphValue = { style: stored, after };
  if (!isSamePlainValue(host.get(LAST_PARAGRAPH_KEY), value)) host.set(LAST_PARAGRAPH_KEY, value);
}

/**
 * Finds which paragraph a stored last-paragraph value belongs to: the one its anchor now falls in
 * (a peer may have appended a newline after it since), or the last one when it has no anchor or
 * the anchor cannot be resolved.
 *
 * @param value - The stored value.
 * @param text - The `Y.Text`.
 * @param characters - The text it holds.
 * @param lastIndex - The index of the text's last paragraph.
 * @returns The paragraph's index.
 */
function anchoredParagraphOf(
  value: LastParagraphValue,
  text: Y.Text,
  characters: string,
  lastIndex: number,
): number {
  if (value.after === undefined) return lastIndex;
  if (value.after === null) return 0;
  const { doc } = text;
  if (doc === null) return lastIndex;
  let position: Y.AbsolutePosition | null = null;
  try {
    position = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(value.after),
      doc,
    );
  } catch {
    return lastIndex;
  }
  if (position?.type !== text) return lastIndex;
  return paragraphCount(characters.slice(0, position.index)) - 1;
}

/**
 * Reads a stored last-paragraph value: its style and anchor, or `undefined` when it is not one (a
 * faulty peer's) or holds a plain style.
 *
 * @param value - The stored value.
 * @returns The value, or `undefined`.
 */
function lastParagraphValueOf(value: unknown): LastParagraphValue | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as { readonly style?: unknown; readonly after?: unknown };
  const style = paragraphStyleOf(record.style);
  if (isPlainParagraph(style)) return undefined;
  return record.after === undefined ? { style } : { style, after: record.after };
}

/**
 * Reads each paragraph's list style, or nothing when every paragraph is plain. The
 * stored last-paragraph style applies to the paragraph its anchor falls in, so when a peer has
 * since appended a newline after that paragraph, the style stays with it and the new last
 * paragraph is plain.
 *
 * @param host - The map that holds the rich text.
 * @param text - Its `Y.Text`.
 * @returns The styles, one per paragraph, or `undefined` when all are plain.
 */
export function readParagraphs(host: Y.Map<unknown>, text: Y.Text): ParagraphStyle[] | undefined {
  const styles = [...newlineParagraphsOf(text.toDelta() as unknown[]), PLAIN_PARAGRAPH];
  const value = lastParagraphValueOf(host.get(LAST_PARAGRAPH_KEY));
  if (value !== undefined) {
    const characters = text.toJSON();
    styles[anchoredParagraphOf(value, text, characters, styles.length - 1)] = value.style;
  }
  return styles.every(isPlainParagraph) ? undefined : styles;
}
