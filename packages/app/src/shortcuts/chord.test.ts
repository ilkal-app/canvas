import { describe, expect, it } from 'vitest';

import { chordsEqual, parseChord } from './chord.js';

describe('parseChord', () => {
  it('maps mod to Command on mac', () => {
    expect(parseChord('mod+shift+z', 'mac')).toEqual({
      key: 'z',
      hasCtrl: false,
      hasAlt: false,
      hasShift: true,
      hasMeta: true,
    });
  });

  it('maps mod to Control elsewhere', () => {
    expect(parseChord('mod+shift+z', 'other')).toEqual({
      key: 'z',
      hasCtrl: true,
      hasAlt: false,
      hasShift: true,
      hasMeta: false,
    });
  });

  it('parses a bare key with no modifiers', () => {
    expect(parseChord('v', 'mac')).toEqual({
      key: 'v',
      hasCtrl: false,
      hasAlt: false,
      hasShift: false,
      hasMeta: false,
    });
  });

  it('is case-insensitive and accepts modifier aliases', () => {
    expect(parseChord('Cmd+Option+]', 'other')).toEqual(parseChord('meta+alt+]', 'other'));
    expect(parseChord('Control+Z', 'mac')).toEqual(parseChord('ctrl+z', 'mac'));
  });

  it('normalises key aliases to their KeyboardEvent.key names', () => {
    expect(parseChord('esc', 'mac').key).toBe('escape');
    expect(parseChord('del', 'mac').key).toBe('delete');
    expect(parseChord('up', 'mac').key).toBe('arrowup');
    expect(parseChord('space', 'mac').key).toBe('space');
  });

  it('parses the plus key on its own and after modifiers', () => {
    expect(parseChord('+', 'mac').key).toBe('+');
    const zoomIn = parseChord('mod++', 'mac');
    expect(zoomIn.key).toBe('+');
    expect(zoomIn.hasMeta).toBe(true);
  });

  it('parses symbol keys such as the question mark', () => {
    expect(parseChord('?', 'other').key).toBe('?');
    expect(parseChord('mod+[', 'other').key).toBe('[');
  });

  it('rejects an empty chord', () => {
    expect(() => parseChord('', 'mac')).toThrow(/empty/);
  });

  it('rejects an unknown modifier', () => {
    expect(() => parseChord('hyper+z', 'mac')).toThrow(/unknown modifier "hyper"/);
  });

  it('rejects a repeated modifier, including mod repeating meta on mac', () => {
    expect(() => parseChord('shift+shift+z', 'mac')).toThrow(/more than once/);
    expect(() => parseChord('mod+meta+z', 'mac')).toThrow(/more than once/);
  });

  it('rejects a chord whose key is itself a modifier', () => {
    expect(() => parseChord('mod+shift', 'mac')).toThrow(/no key/);
  });

  it('rejects an empty segment', () => {
    expect(() => parseChord('mod++z', 'mac')).toThrow(/empty segment/);
  });
});

describe('chordsEqual', () => {
  it('treats mod and the platform key as the same chord', () => {
    expect(chordsEqual(parseChord('mod+z', 'mac'), parseChord('meta+z', 'mac'))).toBe(true);
    expect(chordsEqual(parseChord('mod+z', 'other'), parseChord('ctrl+z', 'other'))).toBe(true);
  });

  it('distinguishes chords that differ in a modifier or the key', () => {
    expect(chordsEqual(parseChord('mod+z', 'mac'), parseChord('mod+shift+z', 'mac'))).toBe(false);
    expect(chordsEqual(parseChord('mod+z', 'mac'), parseChord('mod+y', 'mac'))).toBe(false);
  });
});
