import * as Y from 'yjs';

/**
 * The most characters of a value's own text (a string's start, a number's digits) a description
 * keeps; anything longer is cut. Package-internal, and the bound the tests hold descriptions to.
 */
export const MAX_DESCRIBED_TEXT = 48;

/** What describes a value the helper could not inspect at all (a proxy whose traps throw). */
const UNDESCRIBABLE = 'a value that cannot be inspected';

/**
 * Cuts a text to at most `max` UTF-16 units without splitting a surrogate pair.
 *
 * @param text - The text.
 * @param max - The most units to keep.
 * @returns The text, and how long it was when it was cut.
 */
function cutText(
  text: string,
  max: number,
): { readonly kept: string; readonly cutFrom: number | null } {
  if (text.length <= max) return { kept: text, cutFrom: null };
  const last = text.charCodeAt(max - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return { kept: text.slice(0, max - (isHighSurrogate ? 1 : 0)), cutFrom: text.length };
}

/**
 * The characters a description shows as `\uXXXX` text: C0 and C1 controls (U+009B is a control
 * sequence introducer in some terminals), U+2028 and U+2029 (line separators), and the bidi
 * controls that reorder text around them. A description reaches logs and tooltips.
 */
const UNSAFE_CHARACTERS = /[\p{Cc}\u2028\u2029\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Shows the unsafe characters of a text as `\uXXXX`.
 *
 * @param text - The text.
 * @returns The text with those characters escaped.
 */
function escapeUnsafe(text: string): string {
  return text.replace(
    UNSAFE_CHARACTERS,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * Names a text-like value: the text, cut to a bound, with its length when it was cut, and its
 * unsafe characters escaped.
 *
 * @param text - The text.
 * @param isQuoted - Whether to quote it as JSON does (a string), or show it as is (digits).
 * @returns The description.
 */
function describeText(text: string, isQuoted: boolean): string {
  const { kept, cutFrom } = cutText(text, MAX_DESCRIBED_TEXT);
  const shown = escapeUnsafe(isQuoted ? JSON.stringify(kept) : kept);
  return cutFrom === null ? shown : `${shown}… (${String(cutFrom)} characters)`;
}

/**
 * Names the kind of a Yjs shared type or document.
 *
 * @param value - A `Y.AbstractType` or `Y.Doc`.
 * @returns Its kind, such as `Y.Map`.
 */
function sharedKind(value: Y.AbstractType<unknown> | Y.Doc): string {
  if (value instanceof Y.Doc) return 'Y.Doc';
  const kinds: readonly (readonly [abstract new (...args: never[]) => unknown, string])[] = [
    [Y.XmlHook, 'Y.XmlHook'],
    [Y.XmlElement, 'Y.XmlElement'],
    [Y.XmlText, 'Y.XmlText'],
    [Y.XmlFragment, 'Y.XmlFragment'],
    [Y.Map, 'Y.Map'],
    [Y.Array, 'Y.Array'],
    [Y.Text, 'Y.Text'],
  ];
  return kinds.find(([type]) => value instanceof type)?.[1] ?? 'Y.AbstractType';
}

/**
 * Names an object by its kind, reading nothing of its contents: no `JSON.stringify`, no
 * `toString`, no getter, no recursion, so a cycle, a hostile `toJSON` or a 20,000-deep array
 * costs nothing and cannot throw.
 *
 * @param value - The object.
 * @returns A short description.
 */
function describeObject(value: object): string {
  if (value instanceof Y.Doc || value instanceof Y.AbstractType) {
    return `a shared ${sharedKind(value)} (not a plain value)`;
  }
  if (value instanceof ArrayBuffer) return `binary data of ${String(value.byteLength)} bytes`;
  if (ArrayBuffer.isView(value)) return `binary data of ${String(value.byteLength)} bytes`;
  if (Array.isArray(value)) return `an array of ${String(value.length)} items`;
  return 'an object';
}

/**
 * Describes an undecoded value for a message (a decode issue, a refusal), the one way the codec
 * words such a value. A peer chooses the value, and lib0 carries more than JSON does (bigint,
 * binary, keys like `__proto__`), so `JSON.stringify(value)` or `String(value)` on it can throw
 * (a `bigint`, a cycle, a `toJSON` that throws, an object with no prototype), and a message
 * built from it can be as long as the peer likes. This never throws and its result is bounded:
 * strings, numbers and bigints show their start (a string quoted as JSON, a bigint with an `n`),
 * symbols and functions their kind, shared Yjs types and binary data their kind, other objects
 * their kind and, for an array, its length. It never stringifies a shared type.
 *
 * @param value - Any value, however hostile.
 * @returns A short description, at most about {@link MAX_DESCRIBED_TEXT} characters plus a few
 *   words.
 */
export function describeValue(value: unknown): string {
  try {
    switch (typeof value) {
      case 'string':
        return describeText(value, true);
      case 'number':
        return String(value);
      case 'boolean':
        return String(value);
      case 'undefined':
        return 'undefined';
      case 'bigint':
        return `${describeText(value.toString(), false)}n`;
      case 'symbol':
        return `Symbol(${describeText(value.description ?? '', false)})`;
      case 'function':
        return 'a function';
      case 'object':
        return value === null ? 'null' : describeObject(value);
    }
  } catch {
    return UNDESCRIBABLE;
  }
}

/** The most characters of JSON text {@link describeJson} keeps. */
export const MAX_DESCRIBED_JSON = 200;

/**
 * Describes a value that is normally small JSON and useful to read whole (a stored layout stamp),
 * for a message: the JSON text, cut to {@link MAX_DESCRIBED_JSON} characters, when the value is
 * a plain object or array that `JSON.stringify` can write; otherwise what {@link describeValue}
 * says (a `bigint`, binary data, a shared Yjs type, a cycle, a value with no JSON form). Never
 * throws.
 *
 * @param value - Any value, however hostile.
 * @returns A short description.
 */
export function describeJson(value: unknown): string {
  try {
    const isPlainContainer =
      typeof value === 'object' &&
      value !== null &&
      !(value instanceof Y.AbstractType) &&
      !(value instanceof Y.Doc) &&
      !(value instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(value);
    if (!isPlainContainer) return describeValue(value);
    const json = JSON.stringify(value) as string | undefined;
    if (json === undefined) return describeValue(value);
    const { kept, cutFrom } = cutText(json, MAX_DESCRIBED_JSON);
    return cutFrom === null
      ? escapeUnsafe(kept)
      : `${escapeUnsafe(kept)}… (${String(cutFrom)} characters)`;
  } catch {
    return describeValue(value);
  }
}

/**
 * An id, or the end of a segment, as text for a message: a string as it is (an id is a key of a
 * map, so a string, and the reader's sets compare it exactly), anything else described.
 *
 * @param value - The id or end.
 * @returns The text.
 */
export function describeId(value: unknown): string {
  return typeof value === 'string' ? value : describeValue(value);
}
