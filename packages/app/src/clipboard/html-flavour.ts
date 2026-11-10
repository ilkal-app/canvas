import {
  isFontWeight,
  paragraphCount,
  type FontWeight,
  type ParagraphStyle,
  type Rgba,
  type TextContent,
  type TextStyle,
} from '@canvas/schema';

import { EMBEDDED_OBJECTS_ATTRIBUTE } from './clipboard-formats.js';
import { isOverPasteLimit } from './clipboard-notice.js';
import { declaredLetterSpacing, declaredLineHeight } from './css-spacing.js';
import { listItemStyle } from './html-lists.js';
import { PASTED_TEXT_STYLE, textContentOf } from './pasted-text.js';

/** Elements whose content is not text a person sees. */
const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set([
  'HEAD',
  'META',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
  'TITLE',
]);

/** Elements that start a new line. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'ADDRESS',
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'P',
  'PRE',
  'TR',
]);

/**
 * Parses clipboard HTML in an inert document: nothing in it loads or runs.
 *
 * @param html - The HTML.
 * @returns The document.
 */
function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * The objects flavour a copy from the canvas embeds in its HTML (`data-canvas-objects`), for
 * clipboard paths that keep only standard types. Untrusted: decode it with
 * `decodeObjectsFlavour`.
 *
 * @param html - The clipboard's `text/html`.
 * @returns The embedded JSON, or `undefined` when there is none.
 */
export function embeddedObjectsOf(html: string): string | undefined {
  return embeddedAttributeOf(html, EMBEDDED_OBJECTS_ATTRIBUTE);
}

/**
 * An attribute the canvas writes on its copy's HTML root element (the objects, the board they
 * were copied from). Untrusted.
 *
 * @param html - The clipboard's `text/html`.
 * @param attribute - The attribute.
 * @returns Its value, or `undefined` when there is none.
 */
export function embeddedAttributeOf(html: string, attribute: string): string | undefined {
  if (isOverPasteLimit('text/html', html)) return undefined;
  const holder = parseHtml(html).querySelector(`[${attribute}]`);
  return holder?.getAttribute(attribute) ?? undefined;
}

/**
 * Reads a CSS colour in `rgb()`, `rgba()` or `#rgb`/`#rrggbb` form.
 *
 * @param value - The CSS value.
 * @returns The colour, channels 0–1, or `undefined` for any other form.
 */
function parseCssColour(value: string): Rgba | undefined {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())?.[1];
  if (hex !== undefined) {
    const digits =
      hex.length === 3 ? hex.split('').map((digit) => digit + digit) : hex.match(/../g);
    const [red = 0, green = 0, blue = 0] = (digits ?? []).map((pair) => parseInt(pair, 16) / 255);
    return [red, green, blue, 1];
  }
  const channels = /^rgba?\(([^)]*)\)$/i
    .exec(value.trim())?.[1]
    ?.split(/[\s,/]+/)
    .map(Number);
  if (channels === undefined || channels.length < 3 || channels.some(Number.isNaN))
    return undefined;
  const [red = 0, green = 0, blue = 0, alpha = 1] = channels;
  const unit = (channel: number) => Math.min(1, Math.max(0, channel / 255));
  return [unit(red), unit(green), unit(blue), Math.min(1, Math.max(0, alpha))];
}

/**
 * The weight a CSS `font-weight` declares, if it declares one.
 *
 * @param value - The declaration's value, or empty when there is none.
 * @returns 700 for `bold` and `bolder`, 400 for `normal` and `lighter`, a number as the nearest
 *   of the nine weights, else `undefined`.
 */
function declaredWeight(value: string): FontWeight | undefined {
  if (value === 'bold' || value === 'bolder') return 700;
  if (value === 'normal' || value === 'lighter') return 400;
  const weight = Number(value);
  if (value === '' || !Number.isFinite(weight)) return undefined;
  const nearest = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  return isFontWeight(nearest) ? nearest : undefined;
}

/** The innermost list an element is in while pasted HTML is read. */
interface HtmlList {
  /** Bulleted (`<ul>`) or numbered (`<ol>`). */
  readonly kind: 'bullet' | 'numbered';
  /** How many lists deep it is, at least 1. */
  readonly depth: number;
}

/** Elements that underline their text, and that strike it through. */
const UNDERLINE_ELEMENTS: ReadonlySet<string> = new Set(['U', 'INS']);
const STRIKETHROUGH_ELEMENTS: ReadonlySet<string> = new Set(['S', 'STRIKE', 'DEL']);

/**
 * The underline and strikethrough an element gives its text: its kind's, then an inline
 * `text-decoration` or `text-decoration-line`, which wins (`none` clears both). Read from the
 * style attribute, since a CSS parser may drop the longhand.
 *
 * @param element - The element.
 * @param inherited - Its parent's style.
 * @returns Whether the text is underlined and struck through.
 */
function decorationOf(
  element: HTMLElement,
  inherited: TextStyle,
): { readonly isUnderlined: boolean; readonly isStruckThrough: boolean } {
  let isUnderlined = inherited.underline === true || UNDERLINE_ELEMENTS.has(element.tagName);
  let isStruckThrough =
    inherited.strikethrough === true || STRIKETHROUGH_ELEMENTS.has(element.tagName);
  const declared = /text-decoration(?:-line)?\s*:\s*([^;]+)/giu;
  for (const [, value = ''] of (element.getAttribute('style') ?? '').matchAll(declared)) {
    const lines = value.toLowerCase();
    if (lines.includes('none')) {
      isUnderlined = false;
      isStruckThrough = false;
    }
    if (lines.includes('underline')) isUnderlined = true;
    if (lines.includes('line-through')) isStruckThrough = true;
  }
  return { isUnderlined, isStruckThrough };
}

/**
 * A style with its underline and strikethrough set as given, `false` stored as none.
 *
 * @param style - The style.
 * @param isUnderlined - Whether it is underlined.
 * @param isStruckThrough - Whether it is struck through.
 * @returns The new style; the input is not changed.
 */
function withDecoration(
  style: TextStyle,
  isUnderlined: boolean,
  isStruckThrough: boolean,
): TextStyle {
  const next = { ...style };
  delete next.underline;
  delete next.strikethrough;
  return {
    ...next,
    ...(isUnderlined ? { underline: true } : {}),
    ...(isStruckThrough ? { strikethrough: true } : {}),
  };
}

/**
 * The basic style an element gives its text on top of its parent's: bold (`b`, `strong`, or a
 * `font-weight` of bold or at least 600), italic (`i`, `em`, or `font-style: italic`), an
 * inline `color`, an inline `letter-spacing` and `line-height`, and an underline or
 * strikethrough (`decorationOf`). An inline declaration wins over the element's kind (word processors wrap
 * regular text in `<b style="font-weight: normal">`). Family and size stay the canvas's own.
 *
 * @param element - The element.
 * @param inherited - Its parent's style.
 * @returns The element's style.
 */
function styleOf(element: HTMLElement, inherited: TextStyle): TextStyle {
  const { fontWeight, fontStyle, color, letterSpacing, lineHeight } = element.style;
  const tag = element.tagName;
  const tagWeight = tag === 'B' || tag === 'STRONG' ? 700 : inherited.weight;
  const isTagItalic = tag === 'I' || tag === 'EM' || inherited.italic;
  const isDeclaredItalic =
    fontStyle === 'italic' || fontStyle === 'oblique'
      ? true
      : fontStyle === 'normal'
        ? false
        : undefined;
  const { letterSpacing: inheritedSpacing, lineHeight: inheritedHeight, ...rest } = inherited;
  const { isUnderlined, isStruckThrough } = decorationOf(element, inherited);
  const spacing = declaredLetterSpacing(letterSpacing);
  const height = declaredLineHeight(lineHeight) ?? inheritedHeight;
  const shownSpacing = spacing === null ? undefined : (spacing ?? inheritedSpacing);
  const style: TextStyle = {
    ...rest,
    weight: declaredWeight(fontWeight) ?? tagWeight,
    italic: isDeclaredItalic ?? isTagItalic,
    color: (color === '' ? undefined : parseCssColour(color)) ?? inherited.color,
    ...(shownSpacing === undefined ? {} : { letterSpacing: shownSpacing }),
    ...(height === undefined || height === 'auto' ? {} : { lineHeight: height }),
  };
  return withDecoration(style, isUnderlined, isStruckThrough);
}

/**
 * The text of HTML from outside the canvas with its basic styles: bold, italic, colour, underline
 * and strikethrough on the canvas's base style; block elements and `<br>` start new lines, a
 * newline in the style of the text it ends; each `<li>` starts a list paragraph, bulleted
 * in a `<ul>`, numbered in an `<ol>`, its level the nesting depth. Runs are built from whole text
 * nodes, so no run splits a character. HTML over `MAX_PASTE_MARKUP_LENGTH` is not parsed.
 *
 * @param html - The clipboard's `text/html`.
 * @returns The text and runs, and paragraph styles when it has a list; `undefined` when the
 *   HTML holds no text.
 */
export function textFromHtml(html: string): TextContent | undefined {
  if (isOverPasteLimit('text/html', html)) return undefined;
  const pieces: { text: string; style: TextStyle }[] = [];
  const listStyles = new Map<number, ParagraphStyle>();
  let newlines = 0;
  const newline = () => {
    const last = pieces.at(-1);
    if (last === undefined || last.text.endsWith('\n')) return;
    pieces.push({ text: '\n', style: last.style });
    newlines += 1;
  };
  const visit = (node: Node, style: TextStyle, list?: HtmlList): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      const isLineStart = pieces.at(-1)?.text.endsWith('\n') ?? true;
      const piece = isLineStart ? text.trimStart() : text;
      if (piece.length > 0) pieces.push({ text: piece, style });
      return;
    }
    if (!(node instanceof HTMLElement) || SKIPPED_ELEMENTS.has(node.tagName)) return;
    if (node.tagName === 'BR') {
      pieces.push({ text: '\n', style });
      newlines += 1;
      return;
    }
    const own = styleOf(node, style);
    const isBlock = BLOCK_ELEMENTS.has(node.tagName);
    if (isBlock) newline();
    if (node.tagName === 'LI') {
      listStyles.set(newlines, listItemStyle(list?.kind ?? 'bullet', list?.depth ?? 1));
    }
    const isList = node.tagName === 'UL' || node.tagName === 'OL';
    const inner: HtmlList | undefined = isList
      ? { kind: node.tagName === 'OL' ? 'numbered' : 'bullet', depth: (list?.depth ?? 0) + 1 }
      : list;
    for (const child of node.childNodes) visit(child, own, inner);
    if (isBlock) newline();
  };
  visit(parseHtml(html).body, PASTED_TEXT_STYLE);
  const content = textContentOf(pieces);
  const trimmed = content?.text.trim();
  if (content === undefined || trimmed === undefined || trimmed.length === 0) return undefined;
  const result = trimContent(content);
  if (listStyles.size === 0) return result;
  // Leading newlines trimmed away drop their paragraphs' styles too.
  const leading = content.text.length - content.text.trimStart().length;
  const dropped = paragraphCount(content.text.slice(0, leading)) - 1;
  const paragraphs: ParagraphStyle[] = [];
  for (let index = 0; index < paragraphCount(result.text); index += 1) {
    paragraphs.push(listStyles.get(dropped + index) ?? {});
  }
  return paragraphs.some((paragraph) => paragraph.list !== undefined)
    ? { ...result, paragraphs }
    : result;
}

/**
 * Removes whitespace at both ends of a text, shortening or dropping the runs there.
 *
 * @param content - Text with at least one character that is not whitespace.
 * @returns The trimmed text and runs.
 */
function trimContent(content: TextContent): TextContent {
  const start = content.text.length - content.text.trimStart().length;
  const end = content.text.trimEnd().length;
  const pieces: { text: string; style: TextStyle }[] = [];
  let offset = 0;
  for (const run of content.runs) {
    const from = Math.max(offset, start);
    const to = Math.min(offset + run.length, end);
    if (to > from) pieces.push({ text: content.text.slice(from, to), style: run.style });
    offset += run.length;
  }
  return textContentOf(pieces) ?? content;
}
