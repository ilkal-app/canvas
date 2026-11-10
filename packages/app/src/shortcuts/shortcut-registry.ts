import { chordsEqual, parseChord, type ParsedChord } from './chord.js';
import {
  chordMatchesByCode,
  chordMatchesByDigitPosition,
  chordMatchesByKey,
  type KeyEventLike,
} from './key-event-match.js';
import type { KeyboardPlatform } from './keyboard-platform.js';
import { SHORTCUT_CATEGORIES, type ShortcutCategory } from './shortcut-category.js';

/**
 * A shortcut as a caller declares it: which chords press it, what it is called in the cheat
 * sheet, and the action it dispatches.
 *
 * @template TAction - The action type the shortcut dispatches (the shell uses `ShellAction`).
 */
export interface ShortcutDefinition<TAction> {
  /** Stable identifier, `category.name` by convention (`tools.select`); unique in a registry. */
  readonly id: string;
  /** Chords that press the shortcut, in `mod+shift+z` notation; the first is the primary. */
  readonly chords: readonly string[];
  /** What the shortcut does, as the cheat sheet says it (`Undo`). */
  readonly description: string;
  /** The cheat sheet group it belongs to. */
  readonly category: ShortcutCategory;
  /** The action dispatched when the shortcut is pressed. */
  readonly action: TAction;
  /**
   * Whether the browser's own event carries this shortcut (copy, cut and paste arrive as
   * clipboard events, which alone can read the clipboard). A native shortcut is listed and
   * reserved against conflicts but never matched, so its key press is left to the browser.
   */
  readonly isNative?: boolean;
  /**
   * Whether holding the keys down repeats the action, as for nudging, zooming and undo. When
   * false (the default), the keyboard's auto-repeat is ignored, so a held key toggles once.
   */
  readonly canRepeat?: boolean;
}

/**
 * A registered shortcut: its definition with every chord parsed for the registry's platform.
 *
 * @template TAction - The action type the shortcut dispatches.
 */
export interface ShortcutEntry<TAction> extends ShortcutDefinition<TAction> {
  /** The chords, parsed for the registry's platform, in the order they were declared. */
  readonly parsedChords: readonly ParsedChord[];
  /** Whether the browser's own event carries this shortcut; see {@link ShortcutDefinition}. */
  readonly isNative: boolean;
  /** Whether holding the keys down repeats the action; see {@link ShortcutDefinition}. */
  readonly canRepeat: boolean;
}

/**
 * An immutable set of shortcuts for one platform. Build one with
 * {@link createShortcutRegistry} and {@link registerShortcut}; every operation returns a new
 * registry.
 *
 * @template TAction - The action type the shortcuts dispatch.
 */
export interface ShortcutRegistry<TAction> {
  /** The platform the chords were parsed for. */
  readonly platform: KeyboardPlatform;
  /** The shortcuts, in registration order. */
  readonly entries: readonly ShortcutEntry<TAction>[];
}

/**
 * The shortcuts of one cheat sheet category.
 *
 * @template TAction - The action type the shortcuts dispatch.
 */
export interface ShortcutGroup<TAction> {
  /** The category. */
  readonly category: ShortcutCategory;
  /** The heading the cheat sheet shows. */
  readonly label: string;
  /** The category's shortcuts, in registration order. */
  readonly entries: readonly ShortcutEntry<TAction>[];
}

/**
 * Creates an empty shortcut registry.
 *
 * @param platform - The platform whose meaning of `mod` the registry's chords take.
 * @returns A registry with no shortcuts.
 */
export function createShortcutRegistry<TAction>(
  platform: KeyboardPlatform,
): ShortcutRegistry<TAction> {
  return { platform, entries: [] };
}

function findEntryUsing<TAction>(
  registry: ShortcutRegistry<TAction>,
  chord: ParsedChord,
): ShortcutEntry<TAction> | undefined {
  return registry.entries.find((entry) =>
    entry.parsedChords.some((taken) => chordsEqual(taken, chord)),
  );
}

/**
 * Finds the shortcut, if any, that already uses a chord. Native shortcuts count, so a new
 * binding cannot shadow copy or paste. For a remapping UI and for {@link registerShortcut}.
 *
 * @param registry - The registry to search.
 * @param chord - The chord, in `mod+shift+z` notation.
 * @returns The shortcut using the chord, or undefined when it is free.
 * @throws {Error} When the chord cannot be parsed (see `parseChord`).
 */
export function findShortcutConflict<TAction>(
  registry: ShortcutRegistry<TAction>,
  chord: string,
): ShortcutEntry<TAction> | undefined {
  return findEntryUsing(registry, parseChord(chord, registry.platform));
}

/**
 * Adds a shortcut to a registry, returning a new registry; neither input is changed.
 *
 * @param registry - The registry to add to.
 * @param definition - The shortcut to add.
 * @returns A registry holding the existing shortcuts and the new one, last.
 * @throws {Error} When the id is already registered, the definition has no chords, a chord
 *   cannot be parsed, a chord repeats within the definition, or a chord is already used by
 *   another shortcut on the registry's platform.
 */
export function registerShortcut<TAction>(
  registry: ShortcutRegistry<TAction>,
  definition: ShortcutDefinition<TAction>,
): ShortcutRegistry<TAction> {
  const { id, chords } = definition;
  if (registry.entries.some((entry) => entry.id === id)) {
    throw new Error(`Shortcut "${id}" is already registered.`);
  }
  if (chords.length === 0) throw new Error(`Shortcut "${id}" needs at least one chord.`);
  const parsedChords: ParsedChord[] = [];
  for (const chord of chords) {
    const parsed = parseChord(chord, registry.platform);
    if (parsedChords.some((earlier) => chordsEqual(earlier, parsed))) {
      throw new Error(`Shortcut "${id}" lists ${chord} twice.`);
    }
    const conflict = findEntryUsing(registry, parsed);
    if (conflict !== undefined) {
      throw new Error(`Shortcut "${id}" uses ${chord}, which "${conflict.id}" already uses.`);
    }
    parsedChords.push(parsed);
  }
  const entry: ShortcutEntry<TAction> = {
    ...definition,
    parsedChords,
    isNative: definition.isNative ?? false,
    canRepeat: definition.canRepeat ?? false,
  };
  return { ...registry, entries: [...registry.entries, entry] };
}

/**
 * Finds the shortcut a key event presses. Matching tries, in order: the typed character with
 * exact modifiers; a digit-row key by position with exact modifiers (German Shift+0 types `=`
 * but still means Shift+0); the typed character ignoring Shift for symbol keys (`?`); the
 * physical key read as a US layout (Option+A on mac types `å`). Earlier passes win, so the
 * person's layout decides before key position does, except on the digit row. Native shortcuts
 * never match.
 *
 * @param event - The key event, or any object with its key, code and modifier fields.
 * @param registry - The shortcuts to match against.
 * @returns The pressed shortcut, or undefined when the event presses none.
 */
export function matchShortcut<TAction>(
  event: KeyEventLike,
  registry: ShortcutRegistry<TAction>,
): ShortcutEntry<TAction> | undefined {
  const candidates = registry.entries.filter((entry) => !entry.isNative);
  const passes: ((chord: ParsedChord) => boolean)[] = [
    (chord) => chordMatchesByKey(chord, event, false),
    (chord) => chordMatchesByDigitPosition(chord, event),
    (chord) => chordMatchesByKey(chord, event),
    (chord) => chordMatchesByCode(chord, event),
  ];
  for (const pass of passes) {
    const match = candidates.find((entry) => entry.parsedChords.some(pass));
    if (match !== undefined) return match;
  }
  return undefined;
}

/**
 * Lists a registry's shortcuts grouped by category, in cheat sheet order, for display. Empty
 * categories are left out; native shortcuts are included.
 *
 * @param registry - The registry to list.
 * @returns One group per category that has shortcuts.
 */
export function listShortcuts<TAction>(
  registry: ShortcutRegistry<TAction>,
): ShortcutGroup<TAction>[] {
  return SHORTCUT_CATEGORIES.map(({ category, label }) => ({
    category,
    label,
    entries: registry.entries.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0);
}
