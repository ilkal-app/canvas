import { describe, expect, it, vi } from 'vitest';

interface VariationNormaliser {
  normaliseVariations: (
    axes: readonly {
      tag: string;
      minimum: number;
      default: number;
      maximum: number;
      name: string;
      isHidden: boolean;
    }[],
    requested: Readonly<Record<string, number>>,
  ) => Record<string, number>;
}

const { normaliseVariations } = await vi.importActual<VariationNormaliser>(
  './normalise-variations.js',
);

const axes = Object.freeze([
  Object.freeze({
    tag: 'wght',
    minimum: 400,
    default: 400,
    maximum: 700,
    name: 'Weight',
    isHidden: false,
  }),
  Object.freeze({
    tag: 'wdth',
    minimum: 75,
    default: 100,
    maximum: 125,
    name: 'Width',
    isHidden: false,
  }),
]);

describe('variation normalization', () => {
  it('clamps values below and above each axis range', () => {
    expect(normaliseVariations(axes, { wght: 100, wdth: 200 })).toEqual({ wdth: 125 });
    expect(normaliseVariations(axes, { wght: 900, wdth: 20 })).toEqual({ wght: 700, wdth: 75 });
  });

  it('drops unknown tags and nonfinite values', () => {
    expect(normaliseVariations(axes, { wght: Number.NaN, wdth: Infinity, opsz: 42 })).toEqual({});
    expect(normaliseVariations(axes, { wght: -Infinity, wdth: 90, opsz: 42 })).toEqual({
      wdth: 90,
    });
  });

  it('rounds to the nearest 1/16 axis unit before making a cache coordinate', () => {
    expect(normaliseVariations(axes, { wght: 550.031, wdth: 90.04 })).toEqual({
      wght: 550,
      wdth: 90.0625,
    });
    expect(normaliseVariations(axes, { wght: 550.01 })).toEqual({ wght: 550 });
  });

  it('keeps a rounded coordinate inside an off-grid axis range', () => {
    const narrow = [
      {
        tag: 'slnt',
        minimum: -12.08,
        default: -12.04,
        maximum: -12.01,
        name: 'Slant',
        isHidden: false,
      },
    ];
    const [axis] = narrow;
    if (axis === undefined) throw new Error('Missing axis fixture.');
    const result = normaliseVariations(narrow, { slnt: 100 });
    expect(result.slnt ?? axis.default).toBeGreaterThanOrEqual(axis.minimum);
    expect(result.slnt ?? axis.default).toBeLessThanOrEqual(axis.maximum);
  });

  it('gives the default instance for an off-grid default on a narrow axis', () => {
    const narrow = [
      {
        tag: 'slnt',
        minimum: -12.03,
        default: -12.02,
        maximum: -12.01,
        name: 'Slant',
        isHidden: false,
      },
    ];
    expect(normaliseVariations(narrow, { slnt: -12.02 })).toEqual({});
    expect(normaliseVariations(narrow, { slnt: -12.01 })).toEqual({ slnt: -12.01 });
  });

  it('omits default axes, including values that quantise to the default', () => {
    expect(normaliseVariations(axes, {})).toEqual({});
    expect(normaliseVariations(axes, { wght: 400, wdth: 100.02 })).toEqual({});
  });

  it('is independent of request key order and does not mutate inputs', () => {
    const first = Object.freeze({ wght: 550, wdth: 90 });
    const second = Object.freeze({ wdth: 90, wght: 550 });
    expect(normaliseVariations(axes, first)).toEqual(normaliseVariations(axes, second));
    expect(first).toEqual({ wght: 550, wdth: 90 });
    expect(axes[0]?.default).toBe(400);
  });
});
