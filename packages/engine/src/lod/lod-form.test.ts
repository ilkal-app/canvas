import { describe, expect, it } from 'vitest';

import { bandSideOf, lodEdgesOf, lodFormOf, lodLevelOf } from './lod-form.js';
import type { LodRule } from './lod-rule.js';
import {
  IMAGE_AVERAGE_COLOR_EDGE_PX,
  IMAGE_LOD_RULE,
  LOD_HYSTERESIS,
  PATH_CHORD_BOUNDS_PX,
  PATH_LOD_RULE,
  TEXT_GREEK_LINE_PX,
  TEXT_HIDDEN_LINE_PX,
  TEXT_LOD_RULE,
} from './lod-thresholds.js';

describe('the level-of-detail thresholds', () => {
  it('greeks text under 4 device px a line and hides it under 2.5, with a 20% band', () => {
    expect(TEXT_GREEK_LINE_PX).toBe(4);
    expect(TEXT_HIDDEN_LINE_PX).toBe(2.5);
    expect(IMAGE_AVERAGE_COLOR_EDGE_PX).toBe(8);
    expect(PATH_CHORD_BOUNDS_PX).toBe(6);
    expect(LOD_HYSTERESIS).toBe(0.2);
    expect(TEXT_LOD_RULE.levels.map(({ form }) => form)).toEqual(['greek', 'hidden']);
    expect(IMAGE_LOD_RULE.levels.map(({ form }) => form)).toEqual(['average-color']);
    expect(PATH_LOD_RULE.levels.map(({ form }) => form)).toEqual(['chord']);
  });
});

describe('lodFormOf', () => {
  it('picks the form by on-screen size alone when there is no previous form', () => {
    expect(lodFormOf(TEXT_LOD_RULE, 4)).toBe('full');
    expect(lodFormOf(TEXT_LOD_RULE, 3.99)).toBe('greek');
    expect(lodFormOf(TEXT_LOD_RULE, 2.5)).toBe('greek');
    expect(lodFormOf(TEXT_LOD_RULE, 2.49)).toBe('hidden');
    expect(lodFormOf(IMAGE_LOD_RULE, 7.9)).toBe('average-color');
    expect(lodFormOf(IMAGE_LOD_RULE, 8)).toBe('full');
    expect(lodFormOf(PATH_LOD_RULE, 5.9)).toBe('chord');
    expect(lodFormOf(PATH_LOD_RULE, 6)).toBe('full');
  });

  it('goes cheaper as soon as the size falls under a threshold', () => {
    expect(lodFormOf(TEXT_LOD_RULE, 3.99, 'full')).toBe('greek');
    expect(lodFormOf(TEXT_LOD_RULE, 2.49, 'greek')).toBe('hidden');
    expect(lodFormOf(TEXT_LOD_RULE, 1, 'full')).toBe('hidden');
    expect(lodFormOf(IMAGE_LOD_RULE, 7.99, 'full')).toBe('average-color');
    expect(lodFormOf(PATH_LOD_RULE, 5.99, 'full')).toBe('chord');
  });

  it('keeps a cheaper form until the size is 20% past its threshold', () => {
    expect(lodFormOf(TEXT_LOD_RULE, 4.79, 'greek')).toBe('greek');
    expect(lodFormOf(TEXT_LOD_RULE, 4.8, 'greek')).toBe('full');
    expect(lodFormOf(TEXT_LOD_RULE, 2.99, 'hidden')).toBe('hidden');
    expect(lodFormOf(TEXT_LOD_RULE, 3, 'hidden')).toBe('greek');
    expect(lodFormOf(TEXT_LOD_RULE, 4.8, 'hidden')).toBe('full');
    expect(lodFormOf(IMAGE_LOD_RULE, 9.5, 'average-color')).toBe('average-color');
    expect(lodFormOf(IMAGE_LOD_RULE, 9.6, 'average-color')).toBe('full');
    expect(lodFormOf(PATH_LOD_RULE, 7.19, 'chord')).toBe('chord');
    expect(lodFormOf(PATH_LOD_RULE, 7.2, 'chord')).toBe('full');
  });

  it('does not thrash while a pinch wobbles about a threshold', () => {
    let form = lodFormOf(TEXT_LOD_RULE, 5);
    const forms = [form];
    for (const size of [3.9, 4.1, 3.8, 4.3, 3.95, 4.7, 4.0, 3.99]) {
      form = lodFormOf(TEXT_LOD_RULE, size, form);
      forms.push(form);
    }
    expect(forms).toEqual(['full', ...Array<string>(8).fill('greek')]);
  });

  it('treats a form the rule does not know as the full form', () => {
    expect(lodFormOf(IMAGE_LOD_RULE, 9, 'greek')).toBe('full');
  });
});

describe('lodLevelOf', () => {
  const rule: LodRule = {
    kind: 'test',
    levels: [
      { form: 'greek', belowPx: 10 },
      { form: 'hidden', belowPx: 5 },
    ],
  };

  it('numbers the forms from the full one', () => {
    expect(lodLevelOf(rule, 12)).toBe(0);
    expect(lodLevelOf(rule, 9)).toBe(1);
    expect(lodLevelOf(rule, 4)).toBe(2);
  });

  it('climbs one band at a time', () => {
    expect(lodLevelOf(rule, 6.1, 2)).toBe(1);
    expect(lodLevelOf(rule, 5.9, 2)).toBe(2);
    expect(lodLevelOf(rule, 11.9, 1)).toBe(1);
    expect(lodLevelOf(rule, 12, 1)).toBe(0);
  });
});

describe('bandSideOf and lodEdgesOf', () => {
  it('places a size under a threshold, inside its 20% band or above it', () => {
    expect(bandSideOf(4, 3.99)).toBe(-1);
    expect(bandSideOf(4, 4)).toBe(0);
    expect(bandSideOf(4, 4.79)).toBe(0);
    expect(bandSideOf(4, 4.8)).toBe(1);
  });

  it('lists every size where a form or a band side may change, ascending', () => {
    expect(lodEdgesOf(TEXT_LOD_RULE)).toEqual([2.5, 3, 4, 4.8]);
    expect(lodEdgesOf(IMAGE_LOD_RULE)).toEqual([8, 9.6]);
  });

  it('keeps the 20% band edges for a rule with a narrower band of its own', () => {
    const noBand: LodRule = { ...TEXT_LOD_RULE, hysteresis: 0 };
    expect(lodEdgesOf(noBand)).toEqual([2.5, 3, 4, 4.8]);
    expect(lodFormOf(noBand, 4.01, 'greek')).toBe('full');
    expect(lodFormOf(noBand, 2.51, 'hidden')).toBe('greek');
  });
});
