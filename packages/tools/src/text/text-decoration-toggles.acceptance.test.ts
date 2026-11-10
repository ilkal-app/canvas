import { describe, expect, it } from 'vitest';

import { findRunIssues } from '@canvas/schema';

import { createEditorState } from './editor-state.js';
import { setStyle } from './editor.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';
import * as restyle from './text-restyle.js';

const toggledUnderline = Reflect.get(restyle, 'toggledUnderline') as (
  current: Record<string, boolean>,
) => boolean;
const toggledStrikethrough = Reflect.get(restyle, 'toggledStrikethrough') as (
  current: Record<string, boolean>,
) => boolean;

describe('text decoration editor styles', () => {
  it('toggles each flag off only when every selected character has it', () => {
    expect(toggledUnderline({})).toBe(true);
    expect(toggledUnderline({ underline: false })).toBe(true);
    expect(toggledUnderline({ underline: true })).toBe(false);
    expect(toggledStrikethrough({})).toBe(true);
    expect(toggledStrikethrough({ strikethrough: true })).toBe(false);
  });

  it('styles only the selection and merges neighbouring runs when cleared', () => {
    const initial = { ...createEditorState('abcd', runsOf([4, BASE]), 3), anchor: 1 };
    const underlined = setStyle(initial, { underline: true });
    expect(underlined.runs).toEqual(
      runsOf([1, BASE], [2, { ...BASE, underline: true }], [1, BASE]),
    );
    expect(findRunIssues(underlined.text, underlined.runs)).toEqual([]);
    const plain = setStyle(underlined, { underline: false });
    expect(plain.runs).toEqual(runsOf([4, BASE]));
    expect(findRunIssues(plain.text, plain.runs)).toEqual([]);
  });
});
