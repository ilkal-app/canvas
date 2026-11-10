import { describe, expect, it } from 'vitest';

import { formatAriaKeyShortcut, formatChord, formatChordParts } from './chord-format.js';
import { parseChord } from './chord.js';

describe('formatChordParts', () => {
  it('uses Apple symbols in Apple modifier order on mac', () => {
    expect(formatChordParts(parseChord('mod+alt+shift+ctrl+z', 'mac'), 'mac')).toEqual([
      '⌃',
      '⌥',
      '⇧',
      '⌘',
      'Z',
    ]);
  });

  it('uses words in Ctrl, Alt, Shift order elsewhere', () => {
    expect(formatChordParts(parseChord('mod+shift+alt+z', 'other'), 'other')).toEqual([
      'Ctrl',
      'Alt',
      'Shift',
      'Z',
    ]);
  });

  it('names special keys', () => {
    expect(formatChordParts(parseChord('escape', 'mac'), 'mac')).toEqual(['Esc']);
    expect(formatChordParts(parseChord('backspace', 'mac'), 'mac')).toEqual(['⌫']);
    expect(formatChordParts(parseChord('backspace', 'other'), 'other')).toEqual(['Backspace']);
    expect(formatChordParts(parseChord('shift+arrowup', 'other'), 'other')).toEqual(['Shift', '↑']);
    expect(formatChordParts(parseChord('space', 'other'), 'other')).toEqual(['Space']);
  });

  it('leaves symbol keys as they are', () => {
    expect(formatChordParts(parseChord('?', 'mac'), 'mac')).toEqual(['?']);
    expect(formatChordParts(parseChord('mod+]', 'other'), 'other')).toEqual(['Ctrl', ']']);
  });
});

describe('formatChord', () => {
  it('joins parts without a separator on mac', () => {
    expect(formatChord(parseChord('mod+shift+z', 'mac'), 'mac')).toBe('⇧⌘Z');
  });

  it('joins parts with plus signs elsewhere', () => {
    expect(formatChord(parseChord('mod+shift+z', 'other'), 'other')).toBe('Ctrl+Shift+Z');
  });
});

describe('formatAriaKeyShortcut', () => {
  it('uses the aria-keyshortcuts modifier and key names', () => {
    expect(formatAriaKeyShortcut(parseChord('mod+shift+z', 'mac'))).toBe('Shift+Meta+Z');
    expect(formatAriaKeyShortcut(parseChord('mod+alt+]', 'other'))).toBe('Control+Alt+]');
    expect(formatAriaKeyShortcut(parseChord('v', 'other'))).toBe('V');
    expect(formatAriaKeyShortcut(parseChord('escape', 'other'))).toBe('Escape');
    expect(formatAriaKeyShortcut(parseChord('arrowleft', 'other'))).toBe('ArrowLeft');
    expect(formatAriaKeyShortcut(parseChord('space', 'other'))).toBe('Space');
    expect(formatAriaKeyShortcut(parseChord('mod++', 'other'))).toBe('Control+Plus');
  });
});
