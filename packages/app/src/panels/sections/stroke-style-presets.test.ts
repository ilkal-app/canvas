// The dash presets the inspector and the pen, line and connector tools share (
//): scaled by the stroke's width, recognised back, and the patch a Dash choice sets.
import { describe, expect, it } from 'vitest';

import { dashKindOf, dashPatch, presetDash, presetWidth } from './stroke-style-presets.js';

describe('stroke style presets', () => {
  it('scales a preset by the stroke width, at least 1', () => {
    expect(presetWidth(undefined)).toBe(1);
    expect(presetWidth(0.5)).toBe(1);
    expect(presetDash('dashed', 3)).toEqual({ pattern: [12, 12] });
    expect(presetDash('dotted', 2)).toEqual({ pattern: [0, 4] });
    expect(presetDash('dashed', undefined)).toEqual({ pattern: [4, 4] });
  });

  it('recognises a preset at its width only, and anything else as custom', () => {
    expect(dashKindOf(undefined, 2)).toBe('solid');
    expect(dashKindOf(null, 2)).toBe('solid');
    expect(dashKindOf({ pattern: [8, 8] }, 2)).toBe('dashed');
    expect(dashKindOf({ pattern: [0, 4] }, 2)).toBe('dotted');
    expect(dashKindOf({ pattern: [8, 8] }, 3)).toBe('custom');
    expect(dashKindOf({ pattern: [8, 8], offset: 2 }, 2)).toBe('custom');
    expect(dashKindOf({ pattern: [8, 8, 2] }, 2)).toBe('custom');
  });

  it('sets null for solid, a scaled preset, round caps for dots over butt, nothing for custom', () => {
    expect(dashPatch('solid', { width: 2, strokeCap: 'butt' })).toEqual({ strokeDash: null });
    expect(dashPatch('dashed', { width: 2, strokeCap: 'butt' })).toEqual({
      strokeDash: { pattern: [8, 8] },
    });
    expect(dashPatch('dotted', { width: 2, strokeCap: 'butt' })).toEqual({
      strokeDash: { pattern: [0, 4] },
      strokeCap: 'round',
    });
    expect(dashPatch('dotted', { width: 2, strokeCap: 'square' })).toEqual({
      strokeDash: { pattern: [0, 4] },
    });
    expect(dashPatch('custom', { width: 2, strokeCap: undefined })).toEqual({});
  });
});
