// Acceptance
import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import { boardOf, component, instance, shape, text } from './__fixtures__/component-board.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];
const AXES = [{ name: 'State', values: ['Idle', 'Busy'] }];

describe('resolveInstance with variants', () => {
  it('draws a selected preset fill and text and hides a preset-hidden child', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Busy': { box: { fill: RED }, title: { text: 'Busy' }, hidden: { isHidden: true } },
      },
    });
    const placed = instance('inst', 'main', { variant: { State: 'Busy' } });
    const board = boardOf([
      main,
      shape('box', 'main'),
      text('title', 'main'),
      shape('hidden', 'main'),
      placed,
    ]);
    const resolved = resolveInstance(board, placed).objects;
    expect(resolved.find((object) => object.id === 'inst/box')).toMatchObject({ fill: RED });
    expect(resolved.find((object) => object.id === 'inst/title')).toMatchObject({ text: 'Busy' });
    expect(resolved.some((object) => object.id === 'inst/hidden')).toBe(false);
  });

  it('switches from a default preset to the selected value and lets own fields win', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: {
        'State=Idle': { box: { fill: RED } },
        'State=Busy': { box: { fill: BLUE, isHidden: true } },
      },
    });
    const idle = instance('idle', 'main');
    const busy = instance('busy', 'main', {
      variant: { State: 'Busy' },
      overrides: { box: { isHidden: false, fill: RED } },
    });
    const board = boardOf([main, shape('box', 'main'), idle, busy]);
    expect(
      resolveInstance(board, idle).objects.find((object) => object.id === 'idle/box'),
    ).toMatchObject({ fill: RED });
    expect(
      resolveInstance(board, busy).objects.find((object) => object.id === 'busy/box'),
    ).toMatchObject({ fill: RED });
  });

  it('merges a nested instance selection with the outer record per axis before composing its presets', () => {
    const inner = component('inner', {
      variantAxes: [
        { name: 'State', values: ['Idle', 'Busy'] },
        { name: 'Size', values: ['Small', 'Large'] },
      ],
      variantPresets: {
        'State=Busy': { leaf: { fill: RED } },
        'Size=Large': { leaf: { isHidden: true } },
      },
    });
    const nested = instance('nested', 'inner', {
      parentId: 'outer',
      variant: { State: 'Idle', Size: 'Large' },
    });
    const outer = component('outer', {
      variantAxes: AXES,
      variantPresets: { 'State=Busy': { nested: { variant: { State: 'Busy' } } } },
    });
    const root = instance('root', 'outer', {
      variant: { State: 'Busy' },
      overrides: { nested: { variant: { Size: 'Small' } } },
    });
    const board = boardOf([inner, shape('leaf', 'inner'), outer, nested, root]);
    const resolved = resolveInstance(board, root).objects;
    expect(resolved.find((object) => object.id === 'root/nested')).toMatchObject({
      variant: { State: 'Busy', Size: 'Small' },
    });
    expect(resolved.find((object) => object.id === 'root/nested/leaf')).toMatchObject({
      fill: RED,
    });
  });

  it('uses explicit fourth-parameter overrides for the root expansion', () => {
    const main = component('main', {
      variantAxes: AXES,
      variantPresets: { 'State=Busy': { box: { fill: RED } } },
    });
    const placed = instance('inst', 'main', { variant: { State: 'Busy' } });
    const board = boardOf([main, shape('box', 'main'), placed]);
    const resolved = resolveInstance(board, placed, undefined, { box: { fill: BLUE } });
    expect(resolved.objects.find((object) => object.id === 'inst/box')).toMatchObject({
      fill: BLUE,
    });
  });
});
