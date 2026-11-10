import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import { newStickyObject, NOTE_SIZE } from './new-sticky-object.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 24,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

describe('newStickyObject', () => {
  it('makes an empty 200 × 200 note centred on the point, text centred both ways', () => {
    expect(NOTE_SIZE).toBe(200);
    expect(newStickyObject({ x: 300, y: 150 }, STYLE, [1, 0.74, 0.8, 1])).toEqual({
      type: 'sticky',
      parentId: null,
      x: 200,
      y: 50,
      rotation: 0,
      locked: false,
      width: 200,
      height: 200,
      text: '',
      runs: [{ length: 0, style: STYLE }],
      align: 'center',
      autoWidth: false,
      verticalAlign: 'middle',
      color: [1, 0.74, 0.8, 1],
    });
  });

  it('aligns the text as asked', () => {
    expect(newStickyObject({ x: 0, y: 0 }, STYLE, [1, 1, 1, 1], 'left').align).toBe('left');
  });
});
