import { describe, expect, it } from 'vitest';

import { parseChord } from './chord.js';
import {
  chordMatchesByCode,
  chordMatchesByDigitPosition,
  chordMatchesByKey,
  type KeyEventLike,
} from './key-event-match.js';

function keyEvent(key: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('chordMatchesByKey', () => {
  it('matches a letter regardless of case, so Caps Lock does not break shortcuts', () => {
    expect(chordMatchesByKey(parseChord('v', 'mac'), keyEvent('V'))).toBe(true);
  });

  it('requires exactly the chord modifiers for letters', () => {
    const undo = parseChord('mod+z', 'mac');
    expect(chordMatchesByKey(undo, keyEvent('z', { metaKey: true }))).toBe(true);
    expect(chordMatchesByKey(undo, keyEvent('z', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(chordMatchesByKey(undo, keyEvent('z', { ctrlKey: true }))).toBe(false);
    expect(chordMatchesByKey(undo, keyEvent('z'))).toBe(false);
  });

  it('ignores Shift for a symbol key typed with Shift, such as the question mark', () => {
    expect(chordMatchesByKey(parseChord('?', 'other'), keyEvent('?', { shiftKey: true }))).toBe(
      true,
    );
  });

  it('still rejects other modifiers on a Shift-insensitive symbol key', () => {
    expect(chordMatchesByKey(parseChord('?', 'other'), keyEvent('?', { ctrlKey: true }))).toBe(
      false,
    );
  });

  it('matches named keys such as Escape and the space bar', () => {
    expect(chordMatchesByKey(parseChord('escape', 'mac'), keyEvent('Escape'))).toBe(true);
    expect(chordMatchesByKey(parseChord('space', 'mac'), keyEvent(' '))).toBe(true);
  });

  it('rejects a different key', () => {
    expect(chordMatchesByKey(parseChord('v', 'mac'), keyEvent('b'))).toBe(false);
  });
});

describe('chordMatchesByCode', () => {
  it('does not apply when the typed key is an ASCII letter or digit the layout produced', () => {
    expect(chordMatchesByCode(parseChord('s', 'mac'), keyEvent('o', { code: 'KeyS' }))).toBe(false);
    expect(chordMatchesByCode(parseChord('1', 'mac'), keyEvent('2', { code: 'Digit1' }))).toBe(
      false,
    );
  });

  it('matches Option+letter on mac, where the key is a special character', () => {
    const alignLeft = parseChord('alt+a', 'mac');
    const event = keyEvent('å', { code: 'KeyA', altKey: true });
    expect(chordMatchesByKey(alignLeft, event)).toBe(false);
    expect(chordMatchesByCode(alignLeft, event)).toBe(true);
  });

  it('matches Shift+digit, where the key is the shifted symbol', () => {
    const zoomToFit = parseChord('shift+1', 'other');
    expect(chordMatchesByCode(zoomToFit, keyEvent('!', { code: 'Digit1', shiftKey: true }))).toBe(
      true,
    );
  });

  it('matches bracket and punctuation keys by their US layout character', () => {
    const toFront = parseChord('mod+alt+]', 'mac');
    const event = keyEvent('‘', { code: 'BracketRight', metaKey: true, altKey: true });
    expect(chordMatchesByCode(toFront, event)).toBe(true);
  });

  it('requires exact modifiers, Shift included', () => {
    const zoomToFit = parseChord('shift+1', 'other');
    expect(chordMatchesByCode(zoomToFit, keyEvent('1', { code: 'Digit1' }))).toBe(false);
  });

  it('does not match when the event has no code or an unmapped code', () => {
    expect(chordMatchesByCode(parseChord('a', 'mac'), keyEvent('a'))).toBe(false);
    expect(chordMatchesByCode(parseChord('a', 'mac'), keyEvent('a', { code: 'F13' }))).toBe(false);
  });
});

describe('chordMatchesByDigitPosition', () => {
  it('matches a Shift+digit chord by position when the layout types a symbol there', () => {
    const actualSize = parseChord('shift+0', 'mac');
    expect(
      chordMatchesByDigitPosition(actualSize, keyEvent('=', { code: 'Digit0', shiftKey: true })),
    ).toBe(true);
  });

  it('ignores keys off the digit row, and needs the modifiers exactly', () => {
    expect(
      chordMatchesByDigitPosition(
        parseChord('shift+m', 'mac'),
        keyEvent('?', { code: 'KeyM', shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      chordMatchesByDigitPosition(parseChord('shift+0', 'mac'), keyEvent('=', { code: 'Digit0' })),
    ).toBe(false);
  });
});
