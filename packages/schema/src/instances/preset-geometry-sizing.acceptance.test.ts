// Acceptance
import { describe, expect, it } from 'vitest';

import {
  laidInstanceSize,
  type Board,
  type ComponentObject,
  type InstanceObject,
} from '@canvas/schema';

import { buildChildIndex } from '../board/child-index.js';

import { boardOf, component, id, instance } from './__fixtures__/component-board.js';

/**
 * Read the fixture through the public laid-size rule.
 *
 * @param board - The fixture board.
 * @returns Its instance size in world units.
 */
function size(board: Board): { width: number; height: number } {
  const children = buildChildIndex(board);
  const main = board.objects.get(id('main')) as ComponentObject;
  const placed = board.objects.get(id('inst')) as InstanceObject;
  return laidInstanceSize(
    {
      get: (objectId) => board.objects.get(objectId),
      childrenOf: (objectId) => children.get(objectId) ?? [],
    },
    placed,
    main,
  );
}

const AXES = [{ name: 'Size', values: ['base', 'large'] }];

describe('variant-sized instance axes', () => {
  it('uses the main size when another preset sizes the axis but the selected preset does not', () => {
    const board = boardOf([
      component('main', {
        width: 40,
        height: 42,
        variantAxes: AXES,
        variantPresets: { 'Size=large': { main: { width: 48, height: 50 } } },
      }),
      instance('inst', 'main', { width: 48, height: 50, variant: { Size: 'base' } }),
    ]);
    expect(size(board)).toEqual({ width: 40, height: 42 });
  });

  it('follows the selected root size independently on each unfixed axis', () => {
    const board = boardOf([
      component('main', {
        width: 40,
        height: 42,
        variantAxes: AXES,
        variantPresets: { 'Size=large': { main: { width: 48, height: 50 } } },
      }),
      instance('inst', 'main', {
        width: 60,
        height: 42,
        isWidthFixed: true,
        variant: { Size: 'large' },
      }),
    ]);
    expect(size(board)).toEqual({ width: 60, height: 50 });
  });

  it('keeps stored size on an axis without any root size preset', () => {
    const board = boardOf([
      component('main', {
        width: 40,
        height: 42,
        variantAxes: AXES,
        variantPresets: { 'Size=large': { main: { height: 50 } } },
      }),
      instance('inst', 'main', { width: 60, height: 42, variant: { Size: 'base' } }),
    ]);
    expect(size(board)).toEqual({ width: 60, height: 42 });
  });
});
