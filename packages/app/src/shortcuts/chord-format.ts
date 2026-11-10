import type { ParsedChord } from './chord.js';
import type { KeyboardPlatform } from './keyboard-platform.js';

/** Display names for special keys, shared by every platform. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  space: 'Space',
  delete: 'Del',
  backspace: 'Backspace',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** Display names that differ on mac, where these keys carry symbols. */
const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
  delete: '⌦',
  backspace: '⌫',
  enter: '↩',
};

/** `aria-keyshortcuts` names for keys whose name is not their capitalised `KeyboardEvent.key`. */
const ARIA_KEY_NAMES: Readonly<Record<string, string>> = {
  '+': 'Plus',
  space: 'Space',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

function capitalise(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function keyLabel(key: string, platform: KeyboardPlatform): string {
  const macLabel = platform === 'mac' ? MAC_KEY_LABELS[key] : undefined;
  return macLabel ?? KEY_LABELS[key] ?? key.toUpperCase();
}

/**
 * Formats a chord as the separate keycaps a person presses, for a cheat sheet or a hint:
 * Apple symbols in Apple's order (⌃⌥⇧⌘) on mac, words in Ctrl, Alt, Shift, Win order elsewhere,
 * then the key.
 *
 * @param chord - The chord, parsed for `platform`.
 * @param platform - The platform whose conventions to display.
 * @returns One label per keycap, modifiers first.
 */
export function formatChordParts(chord: ParsedChord, platform: KeyboardPlatform): string[] {
  const parts: string[] = [];
  if (platform === 'mac') {
    if (chord.hasCtrl) parts.push('⌃');
    if (chord.hasAlt) parts.push('⌥');
    if (chord.hasShift) parts.push('⇧');
    if (chord.hasMeta) parts.push('⌘');
  } else {
    if (chord.hasCtrl) parts.push('Ctrl');
    if (chord.hasAlt) parts.push('Alt');
    if (chord.hasShift) parts.push('Shift');
    if (chord.hasMeta) parts.push('Win');
  }
  parts.push(keyLabel(chord.key, platform));
  return parts;
}

/**
 * Formats a chord as one short label, such as `⇧⌘Z` on mac or `Ctrl+Shift+Z` elsewhere.
 *
 * @param chord - The chord, parsed for `platform`.
 * @param platform - The platform whose conventions to display.
 * @returns The label.
 */
export function formatChord(chord: ParsedChord, platform: KeyboardPlatform): string {
  return formatChordParts(chord, platform).join(platform === 'mac' ? '' : '+');
}

/**
 * Formats a chord for the `aria-keyshortcuts` attribute (WAI-ARIA 1.2): modifiers as
 * `Control`, `Alt`, `Shift`, `Meta`, then the key, joined by `+`.
 *
 * @param chord - The chord to describe.
 * @returns The attribute value, such as `Meta+Shift+Z`.
 */
export function formatAriaKeyShortcut(chord: ParsedChord): string {
  const parts: string[] = [];
  if (chord.hasCtrl) parts.push('Control');
  if (chord.hasAlt) parts.push('Alt');
  if (chord.hasShift) parts.push('Shift');
  if (chord.hasMeta) parts.push('Meta');
  parts.push(ARIA_KEY_NAMES[chord.key] ?? capitalise(chord.key));
  return parts.join('+');
}
