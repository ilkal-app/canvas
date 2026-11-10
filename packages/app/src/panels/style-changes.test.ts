import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { styleChangesFor, takesStyle } from './style-changes.js';

function object(type: string, fields: Record<string, unknown> = {}): BoardObject {
  return { id: `${type}-1`, type, ...fields } as unknown as BoardObject;
}

describe('takesStyle', () => {
  it('accepts fields the type takes and refuses any other', () => {
    expect(takesStyle(object('shape', { label: null }), { fill: null })).toBe(true);
    expect(takesStyle(object('sticky'), { fill: null })).toBe(false);
    expect(takesStyle(object('frame'), { background: null, clip: true })).toBe(true);
  });

  it('takes a text style only where there is text', () => {
    const textStyle = { fontSize: 20 };
    expect(takesStyle(object('text'), { textStyle })).toBe(true);
    expect(takesStyle(object('sticky'), { textStyle })).toBe(true);
    expect(takesStyle(object('shape', { label: null }), { textStyle })).toBe(false);
    expect(takesStyle(object('shape', { label: { text: 'a', runs: [] } }), { textStyle })).toBe(
      true,
    );
    expect(takesStyle(object('connector', { label: null }), { textStyle })).toBe(false);
    expect(takesStyle(object('path'), { textStyle })).toBe(false);
  });
});

describe('styleChangesFor', () => {
  it('sets the fields on each selected object that takes them, in selection order', () => {
    const shape = object('shape', { label: null });
    const path = object('path');
    const sticky = object('sticky');
    expect(styleChangesFor([path, sticky, shape], { fill: null })).toEqual([
      { id: path.id, style: { fill: null } },
      { id: shape.id, style: { fill: null } },
    ]);
  });

  it('is empty when nothing selected takes the fields', () => {
    expect(styleChangesFor([object('group')], { fill: null })).toEqual([]);
    expect(styleChangesFor([], { fill: null })).toEqual([]);
  });
});
