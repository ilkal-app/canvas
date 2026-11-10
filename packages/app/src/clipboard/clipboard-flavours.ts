import { inStackingOrder } from '@canvas/document';
import {
  BoardImportError,
  exportBoard,
  resolveColor,
  type Board,
  type BoardObject,
  type ColorMode,
  type ObjectId,
  type StyleRun,
  type TextContent,
  type TokenTable,
} from '@canvas/schema';

import {
  CANVAS_BOARD_MIME_TYPE,
  CANVAS_OBJECTS_MIME_TYPE,
  EMBEDDED_BOARD_ATTRIBUTE,
  EMBEDDED_OBJECTS_ATTRIBUTE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
  type ClipboardFlavours,
} from './clipboard-formats.js';
import {
  MAX_PASTE_OBJECTS,
  PASTE_REFUSED_MESSAGE,
  isOverPasteLimit,
  type ClipboardNotice,
} from './clipboard-notice.js';
import { cssLetterSpacing, cssLineHeight } from './css-spacing.js';
import { importWithExternalMains, importWithExternalMainsInStages } from './external-mains.js';
import { paragraphsHtml } from './html-lists.js';

/**
 * The text an object carries: a text's or sticky's body, a shape's or connector's label.
 *
 * @param object - The object.
 * @returns Its text and runs, or `undefined` when it has none.
 */
function textOf(object: BoardObject): TextContent | undefined {
  if (object.type === 'text' || object.type === 'sticky') return object;
  if (object.type === 'shape' || object.type === 'connector') return object.label ?? undefined;
  return undefined;
}

/**
 * Escapes text for HTML element content or a double-quoted attribute.
 *
 * @param text - The text.
 * @returns The escaped text.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * A run's style as inline CSS: family, size, colour, weight and italic, and a letter-spacing
 * and line-height when set, and an underline or strikethrough.
 *
 * @param run - The run.
 * @param mode - The text's colour mode.
 * @param tokens - The source board's colour tokens.
 * @returns The CSS declarations.
 */
function runCss(run: StyleRun, mode: ColorMode, tokens: TokenTable | undefined): string {
  const { style } = run;
  // `ink` and a colour token are written in the text's colour mode, light where nothing sets
  // one, since another app has no theme, from the board's token table.
  const color = resolveColor(style.color, mode, tokens);
  const [red, green, blue] = color.slice(0, 3).map((channel) => Math.round(channel * 255));
  const rgba = `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(color[3])})`;
  return [
    `font-family: '${style.fontFamily.replaceAll("'", '')}'`,
    `font-size: ${String(style.fontSize)}px`,
    `color: ${rgba}`,
    `font-weight: ${String(style.weight)}`,
    `font-style: ${style.italic ? 'italic' : 'normal'}`,
    ...declaration('letter-spacing', cssLetterSpacing(style)),
    ...declaration('line-height', cssLineHeight(style)),
    ...declaration('text-decoration', cssDecoration(style)),
  ].join('; ');
}

/**
 * A run's underline and strikethrough as a CSS `text-decoration`.
 *
 * @param style - The run's style.
 * @returns The value, or undefined for none.
 */
function cssDecoration(style: StyleRun['style']): string | undefined {
  const lines = [
    ...(style.underline === true ? ['underline'] : []),
    ...(style.strikethrough === true ? ['line-through'] : []),
  ];
  return lines.length === 0 ? undefined : lines.join(' ');
}

/**
 * A CSS declaration, when it has a value.
 *
 * @param property - The property.
 * @param value - Its value, or undefined for none.
 * @returns The declaration, or nothing.
 */
function declaration(property: string, value: string | undefined): string[] {
  return value === undefined ? [] : [`${property}: ${value}`];
}

/**
 * A text's characters `[from, to)` as HTML, a span per run piece.
 *
 * @param content - The text and runs.
 * @param from - Where to start.
 * @param to - Where to end.
 * @param css - A run's inline CSS.
 * @returns The spans.
 */
function spansOf(
  content: TextContent,
  from: number,
  to: number,
  css: (run: StyleRun) => string,
): string {
  let offset = 0;
  let html = '';
  for (const run of content.runs) {
    const start = Math.max(from, offset);
    const end = Math.min(to, offset + run.length);
    offset += run.length;
    if (end <= start) continue;
    const body = escapeHtml(content.text.slice(start, end)).replaceAll('\n', '<br>');
    html += `<span style="${escapeHtml(css(run))}">${body}</span>`;
  }
  return html;
}

/**
 * A text as one HTML paragraph, a span per run, line breaks as `<br>`; a text with lists as a
 * paragraph or a list item per paragraph (`paragraphsHtml`).
 *
 * @param content - The text and runs.
 * @param mode - The text's colour mode.
 * @param tokens - The source board's colour tokens.
 * @returns The paragraph.
 */
function paragraphOf(
  content: TextContent,
  mode: ColorMode,
  tokens: TokenTable | undefined,
): string {
  const css = (run: StyleRun) => runCss(run, mode, tokens);
  const styles = content.paragraphs;
  if (styles?.some((style) => style.list !== undefined) !== true) {
    return `<p>${spansOf(content, 0, content.text.length, css)}</p>`;
  }
  let start = 0;
  const paragraphs = styles.map((style) => {
    const newline = content.text.indexOf('\n', start);
    const end = newline < 0 ? content.text.length : newline;
    const html = spansOf(content, start, end, css);
    start = end + 1;
    return { html, style };
  });
  return paragraphsHtml(paragraphs);
}

/**
 * How a copy's text colours resolve in its HTML flavour: the source board's colour
 * tokens, and each copied object's colour mode there (its ancestors may not be copied).
 */
export interface ClipboardColors {
  /** The source board's colour token table; the built-ins at their defaults when absent. */
  readonly tokens?: TokenTable;
  /**
   * A copied object's colour mode on the source board; light when absent (another app has no
   * theme).
   *
   * @param id - The object.
   * @returns Its mode.
   */
  readonly modeOf?: (id: ObjectId) => ColorMode;
}

/**
 * The clipboard flavours of a copy: the copied
 * board as a portable document (`application/x-canvas-objects+json`), its texts one per line
 * (`text/plain`), and the same texts as styled HTML paragraphs for other apps (`text/html`),
 * whose root element carries the portable document again in `data-canvas-objects`. Texts come
 * in stacking order: parents before children, siblings bottom first. Pure.
 *
 * @param board - The copied board (`copySelection`).
 * @param sourceBoard - The board it was copied from, written as its own flavour
 *   (`application/x-canvas-board`) and on the HTML's root element, so a paste into another board
 *   links its images first; none if absent.
 * @param colors - How the HTML's text colours resolve: the source board's tokens and each copied
 *   object's colour mode there; without them, the built-in light values.
 * @returns The flavours, the objects flavour first.
 */
export function encodeClipboardFlavours(
  board: Board,
  sourceBoard?: string,
  colors: ClipboardColors = {},
): ClipboardFlavours {
  const json = JSON.stringify(exportBoard(board));
  const texts = inStackingOrder(board).flatMap((object) => {
    const content = textOf(object);
    if (content === undefined) return [];
    return [{ content, mode: colors.modeOf?.(object.id) ?? 'light' }];
  });
  const boardAttribute =
    sourceBoard === undefined ? '' : ` ${EMBEDDED_BOARD_ATTRIBUTE}="${escapeHtml(sourceBoard)}"`;
  const paragraphs = texts.map(({ content, mode }) => paragraphOf(content, mode, colors.tokens));
  const html = `<meta charset="utf-8"><div ${EMBEDDED_OBJECTS_ATTRIBUTE}="${escapeHtml(json)}"${boardAttribute}>${paragraphs.join('')}</div>`;
  return new Map([
    [CANVAS_OBJECTS_MIME_TYPE, json],
    ...(sourceBoard === undefined ? [] : [[CANVAS_BOARD_MIME_TYPE, sourceBoard] as const]),
    [PLAIN_TEXT_MIME_TYPE, texts.map(({ content }) => content.text).join('\n')],
    [HTML_MIME_TYPE, html],
  ]);
}

/** What reading an objects flavour found. */
export type ObjectsDecoding =
  | {
      /** A valid portable board. */
      readonly kind: 'board';
      /** The board, imported. */
      readonly board: Board;
    }
  | {
      /** More objects than a paste creates (`MAX_PASTE_OBJECTS`): not imported. */
      readonly kind: 'too-many';
      /** The notice to show. */
      readonly notice: ClipboardNotice;
    }
  | {
      /**
       * A portable board with an object placed past the board's bound (`out-of-bound`): refused,
       * and never a fallback to the plain text of the copy, so the person is told.
       */
      readonly kind: 'refused';
      /** The notice to show. */
      readonly notice: ClipboardNotice;
    }
  | {
      /** Longer than `MAX_PASTE_MARKUP_LENGTH`: not parsed, so a smaller flavour can be used. */
      readonly kind: 'over-limit';
    }
  | {
      /**
       * A portable board of a newer schema version than this build knows: never a
       * fallback to another flavour of the same copy, so the person is told to reload.
       */
      readonly kind: 'newer';
    }
  | {
      /** Not a valid portable board. */
      readonly kind: 'invalid';
    };

/**
 * How many objects a parsed document lists, when it lists them.
 *
 * @param parsed - The parsed JSON.
 * @returns The count, or `undefined` when it holds no list of objects.
 */
export function objectCountOf(parsed: unknown): number | undefined {
  return typeof parsed === 'object' &&
    parsed !== null &&
    'objects' in parsed &&
    Array.isArray(parsed.objects)
    ? parsed.objects.length
    : undefined;
}

/**
 * Reads the objects flavour back as a board, trusting nothing: text over
 * `MAX_PASTE_MARKUP_LENGTH` is not parsed (`over-limit`) and a document of more than
 * `MAX_PASTE_OBJECTS` objects is not imported (`too-many`); otherwise the JSON is parsed and
 * imported with `importBoard` (format tag, migration, every object against its schema, text runs
 * against's boundary rule, unique ids, references), an instance's main allowed to be
 * outside the copy (`importWithExternalMains`). A document of a newer schema version is
 * `newer`.
 *
 * @param json - The flavour's text, from any source.
 * @returns The board, or why there is none.
 */
export function decodeObjectsFlavour(json: string): ObjectsDecoding {
  if (isOverPasteLimit(CANVAS_OBJECTS_MIME_TYPE, json)) return { kind: 'over-limit' };
  try {
    return decodeParsedObjects(JSON.parse(json));
  } catch {
    return { kind: 'invalid' };
  }
}

/**
 * {@link decodeObjectsFlavour} in stages (`importBoardInStages`): the same decoding,
 * `stage` awaited between stages of the import.
 *
 * @param json - The flavour's text, from any source.
 * @param stage - Awaited between stages; what it rejects with is passed on.
 * @returns The board, or why there is none.
 */
export async function decodeObjectsFlavourInStages(
  json: string,
  stage: () => Promise<void>,
): Promise<ObjectsDecoding> {
  if (isOverPasteLimit(CANVAS_OBJECTS_MIME_TYPE, json)) return { kind: 'over-limit' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { kind: 'invalid' };
  }
  return decodeParsedObjectsInStages(parsed, stage);
}

/**
 * Decodes the parsed JSON of an objects flavour, as {@link decodeObjectsFlavour} does after
 * parsing it.
 *
 * @param parsed - The parsed JSON.
 * @returns The board, or why there is none.
 */
export function decodeParsedObjects(parsed: unknown): ObjectsDecoding {
  const tooMany = tooManyOf(parsed);
  if (tooMany !== undefined) return tooMany;
  try {
    return { kind: 'board', board: importWithExternalMains(parsed) };
  } catch (error) {
    return importFailureOf(error);
  }
}

/**
 * {@link decodeParsedObjects} in stages.
 *
 * @param parsed - The parsed JSON.
 * @param stage - Awaited between stages; what it rejects with is passed on.
 * @returns The board, or why there is none.
 */
export async function decodeParsedObjectsInStages(
  parsed: unknown,
  stage: () => Promise<void>,
): Promise<ObjectsDecoding> {
  const tooMany = tooManyOf(parsed);
  if (tooMany !== undefined) return tooMany;
  let board: Board;
  try {
    board = await importWithExternalMainsInStages(parsed, stage);
  } catch (error) {
    if (!(error instanceof BoardImportError)) throw error;
    return importFailureOf(error);
  }
  return { kind: 'board', board };
}

/**
 * The `too-many` decoding of a document listing more objects than a paste creates.
 *
 * @param parsed - The parsed JSON.
 * @returns It, or `undefined` for a document within the limit.
 */
function tooManyOf(parsed: unknown): ObjectsDecoding | undefined {
  const count = objectCountOf(parsed);
  if (count === undefined || count <= MAX_PASTE_OBJECTS) return undefined;
  const limit = MAX_PASTE_OBJECTS.toLocaleString('en-US');
  const message = `This paste holds ${String(count)} objects; a paste creates at most ${limit}.`;
  return { kind: 'too-many', notice: { code: 'paste-too-large', message } };
}

/**
 * Why an import refused a document, as a decoding.
 *
 * @param error - What the import threw.
 * @returns `newer` for a newer schema version, `refused` for an object past the bound, else
 *   `invalid`.
 */
function importFailureOf(error: unknown): ObjectsDecoding {
  if (!(error instanceof BoardImportError)) return { kind: 'invalid' };
  const codes = new Set(error.issues.map(({ code }) => code));
  if (codes.has('unsupported-schema-version')) return { kind: 'newer' };
  // An object placed past the bound is refused with a notice, not passed over as malformed:
  // the next flavour would paste the JSON as text.
  if (codes.has('out-of-bound')) {
    return { kind: 'refused', notice: { code: 'paste-refused', message: PASTE_REFUSED_MESSAGE } };
  }
  return { kind: 'invalid' };
}
