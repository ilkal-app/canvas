import { describe, expect, it } from 'vitest';

import type { VariationAxes } from '@canvas/text';

import { MIXED } from '../controls/mixed-value.js';

import { instanceOptions, instancePatch, selectedInstance } from './text-instances.js';

const AXES: VariationAxes = {
  axes: [
    { tag: 'wght', minimum: 100, default: 400, maximum: 900, name: 'Weight', isHidden: false },
    { tag: 'opsz', minimum: 14, default: 14, maximum: 32, name: 'Optical size', isHidden: false },
  ],
  instances: [
    { name: 'Regular', coordinates: { wght: 400, opsz: 14 } },
    { name: 'Medium', coordinates: { wght: 500, opsz: 14 } },
    { name: 'Bold', coordinates: { wght: 700, opsz: 14 } },
  ],
};

describe('variable font instance choices', () => {
  it('lists every named instance in font order and none for a static family', () => {
    expect(instanceOptions(AXES)).toEqual([
      { value: 'Regular', label: 'Regular' },
      { value: 'Medium', label: 'Medium' },
      { value: 'Bold', label: 'Bold' },
    ]);
    expect(instanceOptions({ axes: [], instances: [] })).toEqual([]);
  });

  it('matches omitted default axes, distinguishes custom coordinates, and keeps mixed distinct', () => {
    expect(selectedInstance(AXES, undefined, 400)).toBe(MIXED);
    expect(selectedInstance(AXES, {}, undefined)).toBe(MIXED);
    expect(selectedInstance(AXES, {}, 400)).toBe('Regular');
    expect(selectedInstance(AXES, {}, 700)).toBe('Bold');
    expect(selectedInstance(AXES, { wght: 700 }, 400)).toBe('Bold');
    expect(selectedInstance(AXES, { wght: 700, opsz: 14 }, 400)).toBe('Bold');
    expect(selectedInstance(AXES, { wght: 650 }, 700)).toBe('Custom');
    expect(selectedInstance(AXES, { opsz: 20 }, 700)).toBe('Custom');
  });

  it('matches named coordinates after the same 1/16-step normalization used for drawing', () => {
    expect(selectedInstance(AXES, { wght: 700.01 }, 400)).toBe('Bold');
    expect(selectedInstance(AXES, { wght: 700.04 }, 400)).toBe('Custom');
  });

  it('writes nondefault coordinates and the nearest hundred weight for a named instance', () => {
    expect(instancePatch(AXES, 'Regular')).toEqual({ fontVariations: {}, weight: 400 });
    expect(instancePatch(AXES, 'Medium')).toEqual({ fontVariations: {}, weight: 500 });
    expect(instancePatch(AXES, 'Bold')).toEqual({ fontVariations: {}, weight: 700 });
    expect(instancePatch(AXES, 'Missing')).toBeUndefined();

    const custom = {
      ...AXES,
      instances: [{ name: 'Heavy', coordinates: { wght: 655, opsz: 20 } }],
    };
    expect(instancePatch(custom, 'Heavy')).toEqual({
      fontVariations: { wght: 655, opsz: 20 },
      weight: 700,
    });

    const betweenWeights = {
      ...AXES,
      instances: [{ name: 'Between', coordinates: { wght: 550, opsz: 14 } }],
    };
    expect(instancePatch(betweenWeights, 'Between')).toEqual({
      fontVariations: { wght: 550 },
      weight: 600,
    });
    expect(selectedInstance(betweenWeights, { wght: 550 }, 600)).toBe('Between');
  });
});
