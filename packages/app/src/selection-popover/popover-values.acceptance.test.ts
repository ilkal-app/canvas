import { describe, expect, it } from 'vitest';

import type { BoardObject, StickyObject, TextObject } from '@canvas/schema';

import type { TextStyleContext } from '../engine/text-style-types.js';
import { MIXED } from '../panels/controls/mixed-value.js';

import { popoverTextValues } from './popover-values.js';

const NOTE = {
  id: 'note-1',
  type: 'sticky',
  verticalAlign: 'top',
  color: [1, 0.9, 0.5, 1],
} as StickyObject;
const TEXT = { id: 'text-1', type: 'text', verticalAlign: 'top' } as TextObject;

/**
 * Supplies the shared text style fields used by the selection control.
 *
 * @param overrides - Fields varied by a case.
 * @returns A text style context.
 */
function context(overrides: Partial<TextStyleContext> = {}): TextStyleContext {
  return {
    style: { fontFamily: 'Lora', fontSize: 16, color: { token: 'brand' } },
    align: 'left',
    isEditing: false,
    ...overrides,
  };
}

describe('popover text values acceptance', () => {
  it('takes shared font, size and token colour from the text style', () => {
    expect(popoverTextValues([NOTE], context())).toMatchObject({
      fontFamily: 'Lora',
      fontSize: 16,
      textColor: { token: 'brand' },
      align: 'left',
      verticalAlign: 'top',
      noteColor: NOTE.color,
    });
    expect(popoverTextValues([NOTE], undefined)).toMatchObject({
      fontFamily: undefined,
      fontSize: undefined,
      textColor: undefined,
      align: undefined,
    });
  });

  it('reports missing style fields as mixed and preserves equal token references', () => {
    const values = popoverTextValues([NOTE], context({ style: { color: { token: 'brand' } } }));
    expect(values.fontFamily).toBe(MIXED);
    expect(values.fontSize).toBe(MIXED);
    expect(values.textColor).toEqual({ token: 'brand' });
    expect(popoverTextValues([NOTE], context({ style: {} })).textColor).toBe(MIXED);
    expect(
      popoverTextValues([NOTE], context({ style: { color: [1, 0.9, 0.5, 1] } })).textColor,
    ).toEqual([1, 0.9, 0.5, 1]);
  });

  it('maps logical alignment and distinguishes mixed from unavailable alignment', () => {
    expect(popoverTextValues([TEXT], context({ align: 'start' })).align).toBe('left');
    expect(popoverTextValues([TEXT], context({ align: 'end' })).align).toBe('right');
    expect(popoverTextValues([TEXT], context({ align: undefined })).align).toBe(MIXED);
    expect(popoverTextValues([TEXT], context({ canAlign: false })).align).toBeUndefined();
  });

  it('compares vertical alignment across stickies and texts, and note colour only for all stickies', () => {
    const note2 = { ...NOTE, id: 'note-2', color: [1, 0.9, 0.5, 1] } as StickyObject;
    const otherText = { ...TEXT, verticalAlign: 'bottom' } as TextObject;
    expect(popoverTextValues([NOTE, note2], context()).noteColor).toEqual(NOTE.color);
    expect(
      popoverTextValues([NOTE, { ...note2, color: { token: 'brand' } }], context()).noteColor,
    ).toBe(MIXED);
    expect(popoverTextValues([NOTE, TEXT], context()).verticalAlign).toBe('top');
    expect(popoverTextValues([NOTE, otherText], context()).verticalAlign).toBe(MIXED);
    expect(popoverTextValues([NOTE, TEXT], context()).noteColor).toBeUndefined();
    expect(
      popoverTextValues([{ type: 'shape' } as BoardObject], context()).verticalAlign,
    ).toBeUndefined();
  });
});
