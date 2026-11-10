import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTE_COLOR } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { stickyToolStyleOf, toolStyleDefaults } from './sticky-style.js';

describe('the sticky tool style', () => {
  it('registers yellow notes with centred text in the text tool default style', () => {
    expect(toolStyleDefaults).toEqual({
      tool: 'sticky',
      style: { color: DEFAULT_NOTE_COLOR, textStyle: DEFAULT_TEXT_STYLE, align: 'center' },
    });
  });

  it("gives a new note the tool's colour, text style, alignment and size, defaults for the rest", () => {
    expect(stickyToolStyleOf(undefined)).toEqual({
      color: DEFAULT_NOTE_COLOR,
      textStyle: DEFAULT_TEXT_STYLE,
      align: 'center',
      aspect: 'square',
    });
    const chosen = stickyToolStyleOf({ color: [0.66, 0.84, 0.98, 1], textStyle: { fontSize: 32 } });
    expect(chosen).toEqual({
      color: [0.66, 0.84, 0.98, 1],
      textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 32 },
      align: 'center',
      aspect: 'square',
    });
    expect(stickyToolStyleOf({ aspect: 'wide' }).aspect).toBe('wide');
  });

  it('keeps a colour token picked for the tool as a reference, not its value', () => {
    const picked = { token: 'accent' };
    const { color } = stickyToolStyleOf({ color: picked });
    expect(color).toEqual({ token: 'accent' });
    expect(color).not.toBe(picked);
  });
});
