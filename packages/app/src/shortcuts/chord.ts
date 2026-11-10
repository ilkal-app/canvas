import type { KeyboardPlatform } from './keyboard-platform.js';

/**
 * A key chord resolved for one platform: the key, as a lowercase `KeyboardEvent.key` name
 * (`z`, `?`, `arrowup`, `escape`, with `space` for the space bar), and the modifiers that must
 * be held. `mod` has already been resolved to Command (mac) or Control (other).
 */
export interface ParsedChord {
  /** The key, lowercase, in `KeyboardEvent.key` naming (`space` for the space bar). */
  readonly key: string;
  /** Whether Control must be held. */
  readonly hasCtrl: boolean;
  /** Whether Alt (Option on mac) must be held. */
  readonly hasAlt: boolean;
  /** Whether Shift must be held. */
  readonly hasShift: boolean;
  /** Whether Meta (Command on mac, the Windows key elsewhere) must be held. */
  readonly hasMeta: boolean;
}

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

/** Modifier spellings a chord may use, with the modifier each names (`mod` is platform-dependent). */
const MODIFIER_ALIASES: Readonly<Record<string, Modifier | 'mod'>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

/** Key spellings a chord may use, with the `KeyboardEvent.key` name (lowercase) each stands for. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  ' ': 'space',
  spacebar: 'space',
  plus: '+',
};

/**
 * Splits a chord string into its modifier tokens and its key token. The key may itself be `+`
 * (`mod++`), so a trailing `++` or a lone `+` is the plus key rather than an empty segment.
 *
 * @param chord - The chord string.
 * @returns The modifier tokens, as written, and the key token.
 */
function splitChord(chord: string): { modifiers: string[]; key: string } {
  if (chord === '+') return { modifiers: [], key: '+' };
  if (chord.endsWith('++')) {
    return { modifiers: chord.slice(0, -2).split('+'), key: '+' };
  }
  const tokens = chord.split('+');
  const key = tokens.pop() ?? '';
  return { modifiers: tokens, key };
}

/**
 * Normalises a key name to lowercase `KeyboardEvent.key` naming, resolving aliases such as
 * `esc`, `del` and `up`. Used for both chord strings and incoming key events.
 *
 * @param key - A key name from a chord string or a `KeyboardEvent.key`.
 * @returns The canonical lowercase key name.
 */
export function normaliseKeyName(key: string): string {
  const lower = key.length === 1 ? key.toLowerCase() : key.trim().toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Parses a chord such as `mod+shift+z`, `?`, `alt+]` or `shift+arrowup` into the key and
 * modifiers it means on one platform. Modifier and key names are case-insensitive; `mod` is
 * Command on mac and Control elsewhere; `cmd`, `option`, `control`, `esc`, `del` and similar
 * aliases are accepted.
 *
 * @param chord - The chord string, modifiers first, joined by `+`.
 * @param platform - The platform whose meaning of `mod` applies.
 * @returns The parsed chord.
 * @throws {Error} When the chord is empty, has an empty segment, names an unknown modifier,
 *   repeats a modifier (including `mod` with `meta` on mac or `ctrl` elsewhere), or has no key.
 */
export function parseChord(chord: string, platform: KeyboardPlatform): ParsedChord {
  if (chord.trim() === '') throw new Error('A shortcut chord cannot be empty.');
  const { modifiers, key } = splitChord(chord);
  const held = new Set<Modifier>();
  for (const token of modifiers) {
    if (token === '') throw new Error(`Chord "${chord}" has an empty segment.`);
    const alias = MODIFIER_ALIASES[token.toLowerCase()];
    if (alias === undefined) throw new Error(`Chord "${chord}" has unknown modifier "${token}".`);
    const modifier = alias === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : alias;
    if (held.has(modifier)) {
      throw new Error(`Chord "${chord}" holds ${modifier} more than once.`);
    }
    held.add(modifier);
  }
  const keyName = normaliseKeyName(key);
  if (keyName === '' || MODIFIER_ALIASES[keyName] !== undefined) {
    throw new Error(`Chord "${chord}" has no key, only modifiers.`);
  }
  return {
    key: keyName,
    hasCtrl: held.has('ctrl'),
    hasAlt: held.has('alt'),
    hasShift: held.has('shift'),
    hasMeta: held.has('meta'),
  };
}

/**
 * Whether two parsed chords are the same keystroke.
 *
 * @param first - One chord.
 * @param second - The other chord.
 * @returns True when the key and every modifier agree.
 */
export function chordsEqual(first: ParsedChord, second: ParsedChord): boolean {
  return (
    first.key === second.key &&
    first.hasCtrl === second.hasCtrl &&
    first.hasAlt === second.hasAlt &&
    first.hasShift === second.hasShift &&
    first.hasMeta === second.hasMeta
  );
}
