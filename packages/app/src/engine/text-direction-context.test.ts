// The style panel's direction fields and the side a start or end alignment shows.
import { describe, expect, it } from 'vitest';

import type { TextObject } from '@canvas/schema';

import { MIXED } from '../panels/controls/mixed-value.js';
import { shownAlign } from '../panels/sections/text-direction-row.js';

import { directionContextOf, isSameStyleContext } from './text-style-context.js';
import type { TextStyleContext } from './text-style-types.js';

/**
 * A text object with only the fields the direction context reads.
 *
 * @param text - Its characters.
 * @param direction - Its direction, if stored.
 * @returns The object.
 */
function text(text: string, direction?: TextObject['direction']): TextObject {
  return { type: 'text', text, ...(direction === undefined ? {} : { direction }) } as TextObject;
}

const BASE: TextStyleContext = { style: {}, align: 'start', isEditing: false };

describe('directionContextOf', () => {
  it('reads an absent direction as auto and differing ones as mixed', () => {
    expect(directionContextOf([text('Hello'), text('Hi', 'auto')])).toEqual({
      direction: 'auto',
    });
    expect(directionContextOf([text('Hello', 'rtl'), text('Hi', 'ltr')])).toEqual({
      direction: MIXED,
    });
    expect(directionContextOf([])).toEqual({ direction: MIXED });
  });

  it('says auto text is right to left only when every auto text starts right to left', () => {
    expect(directionContextOf([text('שלום'), text('مرحبا', 'auto')])).toEqual({
      direction: 'auto',
      autoDirection: 'rtl',
    });
    expect(directionContextOf([text('שלום'), text('Hello')])).toEqual({
      direction: 'auto',
      autoDirection: MIXED,
    });
    expect(directionContextOf([text('Hello'), text('Hi')])).toEqual({ direction: 'auto' });
    expect(directionContextOf([text('Hello', 'rtl')])).toEqual({ direction: 'rtl' });
  });
});

describe('shownAlign', () => {
  it('keeps a physical alignment and resolves start and end by direction', () => {
    expect(shownAlign({ ...BASE, align: 'center', direction: 'rtl' })).toBe('center');
    expect(shownAlign({ ...BASE, align: undefined })).toBeUndefined();
    expect(shownAlign(BASE)).toBe('left');
    expect(shownAlign({ ...BASE, align: 'end' })).toBe('right');
    expect(shownAlign({ ...BASE, direction: 'rtl' })).toBe('right');
    expect(shownAlign({ ...BASE, direction: 'ltr', autoDirection: 'rtl' })).toBe('left');
    expect(shownAlign({ ...BASE, direction: 'auto', autoDirection: 'rtl' })).toBe('right');
    expect(shownAlign({ ...BASE, direction: MIXED })).toBeUndefined();
    expect(shownAlign({ ...BASE, autoDirection: MIXED })).toBeUndefined();
    expect(shownAlign({ ...BASE, direction: 'rtl', autoDirection: MIXED })).toBe('right');
  });
});

describe('isSameStyleContext and direction', () => {
  it('tells contexts apart by direction, auto direction and whether they take one', () => {
    expect(isSameStyleContext(BASE, { ...BASE })).toBe(true);
    expect(isSameStyleContext(BASE, { ...BASE, direction: 'rtl' })).toBe(false);
    expect(isSameStyleContext(BASE, { ...BASE, autoDirection: 'rtl' })).toBe(false);
    expect(isSameStyleContext(BASE, { ...BASE, canDirect: false })).toBe(false);
    expect(isSameStyleContext(BASE, { ...BASE, canSetLanguage: false })).toBe(false);
    expect(isSameStyleContext(BASE, { ...BASE, style: { lang: undefined } })).toBe(false);
    expect(isSameStyleContext(BASE, { ...BASE, style: { lang: 'ja' } })).toBe(false);
  });
});
