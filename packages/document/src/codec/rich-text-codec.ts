import * as Y from 'yjs';

import type { StyleRun, TextContent, TextStyle } from '@canvas/schema';

import {
  LAST_PARAGRAPH_KEY,
  readParagraphs,
  storedParagraphOf,
  wantedParagraphsOf,
  writeParagraphs,
  PARAGRAPH_ATTRIBUTE,
  PLAIN_PARAGRAPH,
} from './paragraph-codec.js';
import { isSamePlainValue } from './plain-value.js';
import {
  copyTextStyle,
  storedTextStyleOf,
  styleFromAttributes,
  stylePatchToAttributes,
  styleToAttributes,
  type TextStylePatch,
} from './style-attributes.js';
import { findCommonEnds } from './text-diff.js';
import { appendRun, overlapRuns, sliceRuns } from './text-runs.js';

/** The key of the `Y.Text` in the map that holds a rich text (an object's map, or a label's). */
export const TEXT_KEY = 'text';

/**
 * The key of the style empty text types in, stored beside the `Y.Text` as a plain value. A
 * `Y.Text` can carry attributes only on characters, so the schema's single zero-length run of
 * empty text (the prototype's rule, `src/text/runs.ts`) lives here instead.
 */
export const EMPTY_TEXT_STYLE_KEY = 'emptyTextStyle';

/**
 * Rebuilds text and runs from a `Y.Text` delta: each insert op is a stretch in one set of
 * attributes, a field without an attribute taking the base style's value
 * (`ATTRIBUTE_BASE_STYLE`). Neighbouring ops with equal styles are merged, because Yjs may split
 * a stretch at redundant format markers after concurrent formatting; empty text gets its one
 * zero-length run in `emptyStyle`.
 *
 * @param delta - The result of `Y.Text#toDelta()`.
 * @param emptyStyle - The style of empty text.
 * @returns The text and its runs under the schema's run invariant, or `null` when the delta
 *   holds an embed (this package never writes one).
 */
export function runsFromDelta(
  delta: readonly unknown[],
  emptyStyle: TextStyle,
): TextContent | null {
  let text = '';
  const runs: StyleRun[] = [];
  for (const op of delta) {
    if (typeof op !== 'object' || op === null) return null;
    const { insert, attributes } = op as {
      readonly insert?: unknown;
      readonly attributes?: unknown;
    };
    if (typeof insert !== 'string') return null;
    text += insert;
    appendRun(runs, insert.length, styleFromAttributes(attributes));
  }
  if (runs.length === 0) runs.push({ length: 0, style: emptyStyle });
  return { text, runs };
}

/**
 * Inserts runs of text at a position, each run with the attributes of its style (the fields
 * that differ from the base style).
 *
 * @param text - The `Y.Text`.
 * @param index - Where to insert, in UTF-16 code units.
 * @param characters - The characters to insert.
 * @param runs - The runs covering `characters`.
 */
function insertRuns(
  text: Y.Text,
  index: number,
  characters: string,
  runs: readonly StyleRun[],
): void {
  let offset = 0;
  for (const run of runs) {
    const slice = characters.slice(offset, offset + run.length);
    text.insert(index + offset, slice, { ...styleToAttributes(run.style) });
    offset += run.length;
  }
}

/**
 * Brings an integrated `Y.Text` to new content with the smallest edit: it replaces only the
 * characters between the common prefix and suffix, then formats only the stretches whose style
 * changed and only with the attributes that changed. Characters and attributes left alone keep
 * merging with concurrent edits.
 *
 * @param text - The `Y.Text`, integrated in a document.
 * @param content - The validated new content.
 * @param emptyStyle - The current style of empty text, to read the current runs with.
 */
function updateRichText(text: Y.Text, content: TextContent, emptyStyle: TextStyle): void {
  const current = text.toJSON();
  const { prefix, suffix } = findCommonEnds(current, content.text);
  const removed = current.length - prefix - suffix;
  if (removed > 0) text.delete(prefix, removed);
  const insertEnd = content.text.length - suffix;
  if (insertEnd > prefix) {
    const characters = content.text.slice(prefix, insertEnd);
    insertRuns(text, prefix, characters, sliceRuns(content.runs, prefix, insertEnd));
  }
  const now = runsFromDelta(text.toDelta() as unknown[], emptyStyle);
  if (now === null) return;
  for (const overlap of overlapRuns(now.runs, content.runs)) {
    const { before, after } = overlap;
    const changed: TextStylePatch = Object.fromEntries(
      Object.entries(after).filter(
        ([key, value]) => !isSamePlainValue(before[key as keyof typeof before], value),
      ),
    );
    // A run that no longer names a board text style is detached: its id is removed,
    // not left from the characters' old attributes.
    if (before.textStyleId !== undefined && after.textStyleId === undefined) {
      Object.assign(changed, { textStyleId: null });
    }
    // Likewise a run that no longer has a language loses its tag.
    // And one that loses its link loses the attribute.
    if (before.link !== undefined && after.link === undefined) {
      Object.assign(changed, { link: null });
    }
    if (before.lang !== undefined && after.lang === undefined) {
      Object.assign(changed, { lang: null });
    }
    // And one that is no longer underlined or struck through loses the flag.
    if (before.underline === true && after.underline !== true) {
      Object.assign(changed, { underline: null });
    }
    if (before.strikethrough === true && after.strikethrough !== true) {
      Object.assign(changed, { strikethrough: null });
    }
    // And one that no longer sets features loses them.
    if (before.fontFeatures !== undefined && after.fontFeatures === undefined) {
      Object.assign(changed, { fontFeatures: null });
    }
    // And one that no longer names a face loses its name.
    if (before.postScriptName !== undefined && after.postScriptName === undefined) {
      Object.assign(changed, { postScriptName: null });
    }
    if (Object.keys(changed).length > 0) {
      text.format(overlap.start, overlap.length, { ...stylePatchToAttributes(changed) });
    }
  }
}

/**
 * Builds the entries of a new map holding rich text: a new `Y.Text` under {@link TEXT_KEY} and
 * the style of the first run under {@link EMPTY_TEXT_STYLE_KEY}. Nothing is read, so the entries
 * can seed a map that is not yet in a document (Yjs warns on reads from such a map).
 *
 * @param content - The validated content.
 * @returns The entries, for `new Y.Map(entries)` or to spread into an object's entries.
 */
export function createRichTextEntries(content: TextContent): [string, unknown][] {
  const text = new Y.Text();
  insertRuns(text, 0, content.text, content.runs);
  const wanted = wantedParagraphsOf(content);
  let paragraph = 0;
  for (
    let index = content.text.indexOf('\n');
    index !== -1;
    index = content.text.indexOf('\n', index + 1)
  ) {
    const stored = storedParagraphOf(wanted[paragraph] ?? PLAIN_PARAGRAPH);
    if (stored !== null) text.format(index, 1, { [PARAGRAPH_ATTRIBUTE]: stored });
    paragraph += 1;
  }
  const entries: [string, unknown][] = [[TEXT_KEY, text]];
  const firstStyle = content.runs[0]?.style;
  if (firstStyle !== undefined) entries.push([EMPTY_TEXT_STYLE_KEY, copyTextStyle(firstStyle)]);
  const last = storedParagraphOf(wanted[paragraph] ?? PLAIN_PARAGRAPH);
  // Not yet in a document, so it has no anchor: it means the text's last paragraph.
  if (last !== null) entries.push([LAST_PARAGRAPH_KEY, { style: last }]);
  return entries;
}

/**
 * Writes rich text into the map that holds it: a new `Y.Text` under {@link TEXT_KEY} when there
 * is none, else an in-place minimal edit of the existing one; and the style of the first run
 * under {@link EMPTY_TEXT_STYLE_KEY}, which is the style the text types in once emptied.
 *
 * @param host - The object's map (text, sticky) or the label's map (shape, connector).
 * @param content - The validated content.
 */
export function writeRichText(host: Y.Map<unknown>, content: TextContent): void {
  const firstStyle = content.runs[0]?.style;
  const storedStyle = host.get(EMPTY_TEXT_STYLE_KEY);
  const readStyle = storedTextStyleOf(storedStyle);
  const existing = host.get(TEXT_KEY);
  if (existing instanceof Y.Text && readStyle !== undefined) {
    updateRichText(existing, content, readStyle);
    writeParagraphs(host, existing, content, false);
  } else {
    const text = new Y.Text();
    host.set(TEXT_KEY, text);
    insertRuns(text, 0, content.text, content.runs);
    writeParagraphs(host, text, content, true);
  }
  if (firstStyle !== undefined && !isSamePlainValue(storedStyle, firstStyle)) {
    host.set(EMPTY_TEXT_STYLE_KEY, copyTextStyle(firstStyle));
  }
}

/**
 * Reads a label (a shape's or connector's), stored the same way in both layouts: `null`, or a
 * nested `Y.Map` holding rich text.
 *
 * @param value - The stored value.
 * @returns The label, or a message saying why it cannot be read.
 */
export function readLabel(value: unknown): TextContent | null | string {
  if (value === null) return null;
  return value instanceof Y.Map
    ? readRichText(value as Y.Map<unknown>)
    : 'the label is neither null nor a Y.Map';
}

/**
 * Writes a label (a shape's or connector's), stored the same way in both layouts: `null` as a
 * plain value, content as a nested `Y.Map` holding rich text, edited in place when one exists.
 *
 * @param map - The object's map.
 * @param key - The label field's key.
 * @param label - The validated label.
 */
export function writeLabel(map: Y.Map<unknown>, key: string, label: TextContent | null): void {
  const existing = map.get(key);
  if (label === null) {
    if (existing !== null) map.set(key, null);
    return;
  }
  if (existing instanceof Y.Map) {
    writeRichText(existing as Y.Map<unknown>, label);
    return;
  }
  const host = new Y.Map<unknown>();
  map.set(key, host);
  writeRichText(host, label);
}

/**
 * Reads rich text from the map that holds it: the text, its runs and, when any paragraph is a
 * list item, each paragraph's list style.
 *
 * @param host - The object's map (text, sticky) or the label's map (shape, connector).
 * @returns The text, runs and paragraphs, or a message saying why they cannot be read.
 */
export function readRichText(host: Y.Map<unknown>): TextContent | string {
  const text = host.get(TEXT_KEY);
  if (!(text instanceof Y.Text)) return 'the text is not a Y.Text';
  const emptyStyle = storedTextStyleOf(host.get(EMPTY_TEXT_STYLE_KEY));
  if (emptyStyle === undefined) return 'the style of empty text is missing';
  const delta = text.toDelta() as unknown[];
  const content = runsFromDelta(delta, emptyStyle);
  if (content === null) return 'the text holds an embed';
  const paragraphs = readParagraphs(host, text);
  return paragraphs === undefined ? content : { ...content, paragraphs };
}
