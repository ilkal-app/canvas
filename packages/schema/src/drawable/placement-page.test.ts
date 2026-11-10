import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';

const placement = { parentId: null, x: 0, y: 0, rotation: 0 };

describe('the door on a placement page', () => {
  it.each([undefined, null, 'page-1', 'P_2-x'])('accepts pageId %j', (pageId) => {
    expect(drawableValuesReason('placement', { ...placement, pageId })).toBeUndefined();
  });

  it.each([17, {}, [], '', 'bad page id', 'x'.repeat(65)])('refuses pageId %j', (pageId) => {
    expect(drawableValuesReason('placement', { ...placement, pageId })).toEqual({
      field: 'pageId',
      reason: 'not-an-id',
    });
  });

  it('lets a value stay as the board holds it', () => {
    const stored = { ...placement, pageId: 17 };
    expect(drawableValuesReason('placement', stored, () => ({ value: stored }))).toBeUndefined();
  });
});
