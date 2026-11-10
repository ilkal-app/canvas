import {
  findRunIssues,
  isFontWeight,
  fontFeaturesSchema,
  fontVariationsSchema,
  postScriptNameSchema,
  letterSpacingSchema,
  lineHeightSchema,
  normalizeLink,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  paragraphCount,
  paragraphStyleSchema,
  type ParagraphStyle,
  type StyleRun,
  type TextStyle,
} from '@canvas/schema';

import { normalizeRuns } from './normalize-runs.js';

/**
 * The clipboard flavour that carries styled text between editors of this app: JSON of
 * `{ text, runs }` (the prototype's `RUNS_MIME`, renamed for this product), with `paragraphs`
 * when the text has a list.
 */
export const RUNS_MIME_TYPE = 'application/x-canvas-runs+json';

/** The longest runs payload read, in characters of JSON, checked before it is parsed. */
export const MAX_RUNS_PAYLOAD_CHARS = 1_000_000;

/** Styled text as it travels on the clipboard. */
export interface RunsPayload {
  /** The characters. */
  readonly text: string;
  /** Their runs, under the schema's run invariant. */
  readonly runs: readonly StyleRun[];
  /** One style per paragraph when any is a list; absent for plain paragraphs. */
  readonly paragraphs?: readonly ParagraphStyle[] | undefined;
}

/**
 * Writes styled text as the clipboard's runs flavour.
 *
 * @param payload - The text and its runs.
 * @returns The JSON.
 */
export function serializeRunsPayload(payload: RunsPayload): string {
  const { text, runs, paragraphs } = payload;
  const hasLists = paragraphs?.some((style) => style.list !== undefined) === true;
  return JSON.stringify(hasLists ? { text, runs, paragraphs } : { text, runs });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Reads one run's style from untrusted JSON: a family of 1 to 200 characters, a finite size
 * clamped to the schema's range, four finite colour channels clamped to [0, 1], one of the nine
 * weights or else 400, italic only when `true`, and a letter-spacing, line-height and non-empty
 * variable-font coordinates only when the schema accepts them (any other value
 * is left out).
 *
 * @param value - The parsed value.
 * @returns The style, or undefined when a field is missing or of the wrong type.
 */
function parseStyle(value: unknown): TextStyle | undefined {
  if (!isRecord(value)) return undefined;
  const { fontFamily, fontSize, color } = value;
  if (typeof fontFamily !== 'string' || fontFamily.length === 0 || fontFamily.length > 200) {
    return undefined;
  }
  if (typeof fontSize !== 'number' || !Number.isFinite(fontSize)) return undefined;
  if (!Array.isArray(color) || color.length !== 4) return undefined;
  const channels: number[] = [];
  for (const channel of color as unknown[]) {
    if (typeof channel !== 'number' || !Number.isFinite(channel)) return undefined;
    channels.push(clamp(channel, 0, 1));
  }
  const [red = 0, green = 0, blue = 0, alpha = 0] = channels;
  const letterSpacing = letterSpacingSchema.safeParse(value.letterSpacing);
  const lineHeight = lineHeightSchema.safeParse(value.lineHeight);
  const coordinates = fontVariationsSchema.safeParse(value.fontVariations);
  const features = fontFeaturesSchema.safeParse(value.fontFeatures);
  const face = postScriptNameSchema.safeParse(value.postScriptName);
  return {
    fontFamily,
    fontSize: clamp(fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    color: [red, green, blue, alpha],
    weight: isFontWeight(value.weight) ? value.weight : 400,
    italic: value.italic === true,
    ...(letterSpacing.success ? { letterSpacing: letterSpacing.data } : {}),
    ...(lineHeight.success && lineHeight.data !== 'auto' ? { lineHeight: lineHeight.data } : {}),
    // Variable-font coordinates: kept when valid, none when empty or malformed.
    ...(coordinates.success && Object.keys(coordinates.data).length > 0
      ? { fontVariations: coordinates.data }
      : {}),
    // OpenType features: kept when valid, none when empty or malformed.
    ...(features.success && Object.keys(features.data).length > 0
      ? { fontFeatures: features.data }
      : {}),
    // The face's PostScript name: kept when valid, none when malformed.
    ...(face.success ? { postScriptName: face.data } : {}),
    // The link: kept only when it is a valid link in its normal form, as the schema
    // requires; a `javascript:` or `data:` URL, or one with credentials, is dropped.
    ...(isRunLink(value.link) ? { link: value.link } : {}),
    // Underline and strikethrough: only `true` is kept.
    ...(value.underline === true ? { underline: true } : {}),
    ...(value.strikethrough === true ? { strikethrough: true } : {}),
  };
}

/**
 * Tells whether a pasted value is a run's link: a URL `normalizeLink` leaves unchanged.
 *
 * @param value - The pasted value.
 * @returns True for a valid link.
 */
function isRunLink(value: unknown): value is string {
  return typeof value === 'string' && normalizeLink(value) === value;
}

/**
 * Reads the clipboard's runs flavour, which any page could have written: validated, never
 * trusted (the prototype's `parseRunsPayload`). The text must be non-empty, every run a whole
 * non-negative length with a readable style (sizes and channels clamped), the lengths must sum
 * to the text's length, and after merging neighbours the runs must meet the schema's run
 * invariant, run boundaries between characters included. Never throws.
 *
 * @param json - The flavour's data.
 * @returns The text and runs, or undefined for anything malformed or too long.
 */
export function parseRunsPayload(json: string): RunsPayload | undefined {
  if (json.length > MAX_RUNS_PAYLOAD_CHARS) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.text !== 'string' || value.text.length === 0) {
    return undefined;
  }
  if (!Array.isArray(value.runs)) return undefined;
  const runs: StyleRun[] = [];
  for (const run of value.runs as unknown[]) {
    if (!isRecord(run) || typeof run.length !== 'number' || !Number.isInteger(run.length)) {
      return undefined;
    }
    const style = parseStyle(run.style);
    if (run.length < 0 || style === undefined) return undefined;
    runs.push({ length: run.length, style });
  }
  if (runs.length === 0) return undefined;
  const text = value.text;
  const normalized = normalizeRuns(runs);
  if (findRunIssues(text, normalized).length > 0) return undefined;
  const paragraphs = parseParagraphs(value.paragraphs, text);
  return paragraphs === undefined
    ? { text, runs: normalized }
    : { text, runs: normalized, paragraphs };
}

/**
 * Reads the paragraph styles of pasted text: kept only when there is one valid style
 * per paragraph and one is a list; otherwise the paste's paragraphs are plain.
 *
 * @param value - The parsed `paragraphs`.
 * @param text - The pasted text.
 * @returns The styles, or undefined.
 */
function parseParagraphs(value: unknown, text: string): ParagraphStyle[] | undefined {
  if (!Array.isArray(value) || value.length !== paragraphCount(text)) return undefined;
  const styles: ParagraphStyle[] = [];
  for (const item of value as unknown[]) {
    const style = paragraphStyleSchema.safeParse(item);
    if (!style.success) return undefined;
    styles.push(style.data);
  }
  return styles.some((style) => style.list !== undefined) ? styles : undefined;
}
