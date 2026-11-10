import { describe, expect, it } from 'vitest';

import { familyWeights, weightOptions } from './text-weights.js';

describe('the style panel’s weight field', () => {
  it('lists the weights a family supplies, lightest first, or regular and bold when unknown', () => {
    const faces = [{ weight: 700 }, { weight: 400 }, { weight: 500 }, { weight: 400 }] as const;
    expect(familyWeights(faces)).toEqual([400, 500, 700]);
    expect(familyWeights(undefined)).toEqual([400, 700]);
    expect(familyWeights([])).toEqual([400, 700]);
  });

  it('names each weight, keeping a weight the family lacks as drawn by the nearest face', () => {
    expect(weightOptions([400, 700], 400)).toEqual([
      { value: '400', label: 'Regular 400' },
      { value: '700', label: 'Bold 700' },
    ]);
    expect(weightOptions([400, 700], 600)).toEqual([
      { value: '400', label: 'Regular 400' },
      { value: '600', label: 'SemiBold 600 (nearest face)' },
      { value: '700', label: 'Bold 700' },
    ]);
    expect(weightOptions([300, 400, 500, 600, 700], undefined).map(({ label }) => label)).toEqual([
      'Light 300',
      'Regular 400',
      'Medium 500',
      'SemiBold 600',
      'Bold 700',
    ]);
  });
});
