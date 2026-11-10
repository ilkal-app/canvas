// Acceptance
import { describe, expect, it } from 'vitest';

import { effectiveOverrides, effectiveOverridesOf } from '@canvas/schema';

import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import { boardOf, component, instance } from './__fixtures__/component-board.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];
const SIZE = { width: 40, height: 20 };
const AXES = [
  { name: 'State', values: ['Idle', 'Busy'] },
  { name: 'Size', values: ['Small', 'Large'] },
];

describe('effective variant overrides', () => {
  it('composes selected presets in axis order field by field, then own overrides', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': {
          child: {
            fill: RED,
            isHidden: true,
            textStyle: { weight: 700 },
            variant: { Color: 'Red', Mode: 'One' },
          },
        },
        'Size=Large': {
          child: { fill: BLUE, textStyle: { italic: true }, variant: { Mode: 'Two' } },
        },
      },
    });
    const placed = instance('inst', 'main', {
      variant: { State: 'Busy', Size: 'Large' },
      overrides: {
        child: { isHidden: false, textStyle: { color: RED }, variant: { Color: 'Blue' } },
      },
    });
    expect(effectiveOverrides(placed, main)).toEqual({
      child: {
        fill: BLUE,
        isHidden: false,
        textStyle: { weight: 700, italic: true, color: RED },
        variant: { Color: 'Blue', Mode: 'Two' },
      },
    });
  });

  it('pairs each later text with its own runs, dropping earlier runs when absent', () => {
    const runs = [
      {
        length: 3,
        style: { fontFamily: 'Inter', fontSize: 24, color: RED, weight: 400, italic: false },
      },
    ];
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { text: 'Old', runs } },
        'Size=Large': { child: { text: 'New' } },
      },
    });
    expect(
      effectiveOverrides(
        instance('inst', 'main', { variant: { State: 'Busy', Size: 'Large' } }),
        main,
      ),
    ).toEqual({ child: { text: 'New' } });
    expect(
      effectiveOverrides(
        instance('inst', 'main', {
          variant: { State: 'Busy' },
          overrides: { child: { text: 'Own', runs } },
        }),
        main,
      ),
    ).toEqual({ child: { text: 'Own', runs } });
  });

  it('keeps a measurement when the same record supplies text and size', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { text: 'One', textStyle: { weight: 700 }, measuredSize: SIZE } },
      },
    });
    expect(
      effectiveOverrides(instance('inst', 'main', { variant: { State: 'Busy' } }), main).child,
    ).toMatchObject({ text: 'One', textStyle: { weight: 700 }, measuredSize: SIZE });
  });

  it('keeps a measure-only own record over preset text', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { text: 'One', textStyle: { weight: 700 } } },
      },
    });
    expect(
      effectiveOverrides(
        instance('inst', 'main', {
          variant: { State: 'Busy' },
          overrides: { child: { measuredSize: SIZE } },
        }),
        main,
      ).child,
    ).toEqual({ text: 'One', textStyle: { weight: 700 }, measuredSize: SIZE });
  });

  it('drops a preset measurement when an own record adds a textStyle key', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { text: 'One', textStyle: { weight: 700 }, measuredSize: SIZE } },
      },
    });
    expect(
      effectiveOverrides(
        instance('inst', 'main', {
          variant: { State: 'Busy' },
          overrides: { child: { textStyle: { italic: true } } },
        }),
        main,
      ).child,
    ).toEqual({ text: 'One', textStyle: { weight: 700, italic: true } });
  });

  it('drops a preset measurement when a later axis supplies text', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { text: 'One', measuredSize: SIZE } },
        'Size=Large': { child: { text: 'Two' } },
      },
    });
    expect(
      effectiveOverrides(
        instance('inst', 'main', { variant: { State: 'Busy', Size: 'Large' } }),
        main,
      ).child,
    ).toEqual({ text: 'Two' });
  });

  it('drops a measure-only record when a later axis supplies text', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { measuredSize: SIZE } },
        'Size=Large': { child: { text: 'Two' } },
      },
    });
    expect(
      effectiveOverrides(
        instance('inst', 'main', { variant: { State: 'Busy', Size: 'Large' } }),
        main,
      ).child,
    ).toEqual({ text: 'Two' });
  });

  it('drops a measurement when a later record supplies runs', () => {
    const runs = [
      {
        length: 3,
        style: { fontFamily: 'Inter', fontSize: 24, color: RED, weight: 400, italic: false },
      },
    ];
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { child: { text: 'One', measuredSize: SIZE } },
        'Size=Large': { child: { runs } },
      },
    });
    expect(
      effectiveOverrides(
        instance('inst', 'main', { variant: { State: 'Busy', Size: 'Large' } }),
        main,
      ).child,
    ).toEqual({ text: 'One', runs });
  });

  it('returns the own overrides by identity without axes or when the main is missing', () => {
    const placed = instance('inst', 'missing', { overrides: { child: { isHidden: true } } });
    expect(effectiveOverrides(placed, component('main'))).toBe(placed.overrides);
    expect(effectiveOverridesOf(placed, boardOf([placed]))).toBe(placed.overrides);
  });

  it('leaves frozen inputs untouched', () => {
    const main = deepFreeze(
      component('main', {
        variantAxes: AXES,
        variantPresets: { 'State=Busy': { child: { text: 'Preset' } } },
      }),
    );
    const placed = deepFreeze(
      instance('inst', 'main', {
        variant: { State: 'Busy' },
        overrides: { child: { isHidden: true } },
      }),
    );
    expect(effectiveOverrides(placed, main).child).toEqual({ text: 'Preset', isHidden: true });
    expect(placed).toMatchObject({ variant: { State: 'Busy' } });
  });

  it('falls back to the current default after a value is removed without rewriting selection', () => {
    const main = component('main', {
      variantAxes: [{ name: 'State', values: ['Idle', 'Busy'] }],
      variantPresets: { 'State=Idle': { child: { isHidden: true } } },
    });
    const placed = instance('inst', 'main', { variant: { State: 'Removed' } });
    expect(effectiveOverrides(placed, main)).toEqual({ child: { isHidden: true } });
    expect(placed).toMatchObject({ variant: { State: 'Removed' } });
  });
});
