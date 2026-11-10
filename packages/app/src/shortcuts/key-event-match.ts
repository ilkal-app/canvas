import { normaliseKeyName, type ParsedChord } from './chord.js';

/**
 * The fields of a keyboard event that shortcut matching reads. A type only: the shortcuts
 * module never touches the DOM at runtime, so tests pass plain objects and a headless caller
 * could too.
 */
export type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

/** US-layout characters of the punctuation keys, by `KeyboardEvent.code`. */
const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

const LETTER_CODE_PATTERN = /^Key([A-Z])$/;
const DIGIT_CODE_PATTERN = /^Digit([0-9])$/;
const LETTER_PATTERN = /^[a-z]$/;
const ASCII_LETTER_OR_DIGIT_PATTERN = /^[a-z0-9]$/;

/**
 * The key a physical key position produces on a US layout, from `KeyboardEvent.code`.
 *
 * @param code - The event's `code`, such as `KeyA`, `Digit1` or `BracketRight`.
 * @returns The lowercase key name, or undefined for a code with no mapping.
 */
function keyFromCode(code: string): string | undefined {
  const letter = LETTER_CODE_PATTERN.exec(code)?.[1];
  if (letter !== undefined) return letter.toLowerCase();
  const digit = DIGIT_CODE_PATTERN.exec(code)?.[1];
  if (digit !== undefined) return digit;
  return PUNCTUATION_CODES[code];
}

function modifiersMatch(chord: ParsedChord, event: KeyEventLike, isShiftIgnored: boolean): boolean {
  return (
    chord.hasCtrl === event.ctrlKey &&
    chord.hasAlt === event.altKey &&
    chord.hasMeta === event.metaKey &&
    (isShiftIgnored || chord.hasShift === event.shiftKey)
  );
}

/**
 * Whether a chord's key is a symbol or digit that some layouts type with Shift held (`?` is
 * Shift+/ on US keyboards; digits need Shift on AZERTY). Such a chord, written without `shift`,
 * matches whether or not Shift is down, since the character itself says what was meant.
 *
 * @param chord - The chord to classify.
 * @returns True for a one-character, non-letter key in a chord without `shift`.
 */
export function isShiftInsensitive(chord: ParsedChord): boolean {
  return !chord.hasShift && chord.key.length === 1 && !LETTER_PATTERN.test(chord.key);
}

/**
 * Whether an event presses a chord, judged by the character typed (`KeyboardEvent.key`), which
 * follows the person's keyboard layout. Modifiers must match exactly, except that Shift is
 * ignored for a {@link isShiftInsensitive | Shift-insensitive} chord.
 *
 * @param chord - The chord to test.
 * @param event - The key event.
 * @param isShiftIgnored - Whether to ignore Shift; defaults to what the chord allows. Matching
 *   passes `false` first so that an exact match wins over a Shift-insensitive one.
 * @returns True when the event presses the chord.
 */
export function chordMatchesByKey(
  chord: ParsedChord,
  event: KeyEventLike,
  isShiftIgnored = isShiftInsensitive(chord),
): boolean {
  return normaliseKeyName(event.key) === chord.key && modifiersMatch(chord, event, isShiftIgnored);
}

/**
 * Whether an event presses a chord, judged by the physical key (`KeyboardEvent.code`) read as a
 * US layout. The fallback for when a modifier changes the typed character (Option+A types `å`
 * on mac, Shift+1 types `!`) or the layout is not Latin (Russian types `е` on T). It never
 * applies when the typed key is an ASCII letter or digit: that is what the person's layout
 * (Dvorak, AZERTY, QWERTZ) says they pressed, and reading its position as QWERTY would run the
 * wrong shortcut. Modifiers, Shift included, must match exactly.
 *
 * @param chord - The chord to test.
 * @param event - The key event.
 * @returns True when the event's physical key and modifiers are the chord's.
 */
export function chordMatchesByCode(chord: ParsedChord, event: KeyEventLike): boolean {
  if (ASCII_LETTER_OR_DIGIT_PATTERN.test(normaliseKeyName(event.key))) return false;
  const codeKey = keyFromCode(event.code);
  return codeKey === chord.key && modifiersMatch(chord, event, false);
}

/**
 * Whether an event presses a chord on the digit row by position: {@link chordMatchesByCode},
 * limited to the `Digit0`–`Digit9` keys. Matching tries it before a Shift-insensitive symbol
 * match, so a Shift+digit shortcut (Shift+0 to 100%, Shift+1 to fit) stays on its key where the
 * layout types a symbol with it that has a shortcut of its own: German, Nordic, Spanish and
 * Italian Shift+0 type `=`, Swiss Shift+1 types `+`. It is limited to digits because elsewhere
 * the symbol is what the person meant: AZERTY types `?` with Shift on the M position.
 *
 * @param chord - The chord to test.
 * @param event - The key event.
 * @returns True when the event is a digit-row key whose position and modifiers are the chord's.
 */
export function chordMatchesByDigitPosition(chord: ParsedChord, event: KeyEventLike): boolean {
  return DIGIT_CODE_PATTERN.test(event.code) && chordMatchesByCode(chord, event);
}
