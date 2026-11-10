// Acceptance
import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import { buildChildIndex } from '../board/child-index.js';
import type { ComponentObject } from '../objects/component-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { boardOf, component, frame, id, instance, shape } from './__fixtures__/component-board.js';
import { laidInstanceSize } from './instance-layout.js';
import { resolveInstanceChild } from './resolve-instance-child.js';

const ROW = {
  direction: 'row',
  gap: 5,
  padding: { top: 2, right: 2, bottom: 2, left: 2 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

/**
 * Reads a fixture board as the layout's object and child reader.
 *
 * @param board - The fixture board.
 * @returns A layout reader.
 */
function reader(board: Board) {
  const children = buildChildIndex(board);
  return {
    get: (objectId: ComponentObject['id']) => board.objects.get(objectId),
    childrenOf: (objectId: ComponentObject['id']) => children.get(objectId) ?? [],
  };
}

/**
 * Gets the fixture main and instance for laid-size assertions.
 *
 * @param board - The fixture board.
 * @returns Its main and instance.
 */
function pair(board: Board): [ComponentObject, InstanceObject] {
  return [
    board.objects.get(id('main')) as ComponentObject,
    board.objects.get(id('inst')) as InstanceObject,
  ];
}

describe('laidInstanceSize with preset geometry', () => {
  it('hugs record-sized children with the root gap and padding patch', () => {
    const board = boardOf([
      component('main', {
        width: 100,
        height: 40,
        autoLayout: ROW,
        variantAxes: [{ name: 'Size', values: ['Base', 'Large'] }],
        variantPresets: {
          'Size=Large': {
            main: { autoLayout: { gap: 10, padding: { top: 3, right: 7, bottom: 5, left: 4 } } },
            first: { width: 40, height: 24 },
          },
        },
      }),
      shape('first', 'main', { width: 20, height: 20, z: 'a0' }),
      shape('last', 'main', { width: 30, height: 10, z: 'a1' }),
      instance('inst', 'main', { width: 100, height: 40, variant: { Size: 'Large' } }),
    ]);
    const [main, placed] = pair(board);
    expect(laidInstanceSize(reader(board), placed, main)).toEqual({ width: 91, height: 32 });
  });

  it('uses a root record size on non-layout axes, with own records winning over presets', () => {
    const board = boardOf([
      component('main', {
        width: 100,
        height: 50,
        variantAxes: [{ name: 'Size', values: ['Base', 'Large'] }],
        variantPresets: { 'Size=Large': { main: { width: 140, height: 70 } } },
      }),
      instance('inst', 'main', {
        width: 100,
        height: 50,
        variant: { Size: 'Large' },
        overrides: { main: { width: 160 } },
      }),
    ]);
    const [main, placed] = pair(board);
    expect(laidInstanceSize(reader(board), placed, main)).toEqual({ width: 160, height: 70 });
  });

  it('keeps each instance-fixed axis while the other axis follows root or hug size', () => {
    const board = boardOf([
      component('main', {
        width: 100,
        height: 50,
        variantAxes: [{ name: 'Size', values: ['Base', 'Large'] }],
        variantPresets: { 'Size=Large': { main: { width: 140, height: 70 } } },
      }),
      instance('inst', 'main', {
        width: 300,
        height: 50,
        isWidthFixed: true,
        variant: { Size: 'Large' },
      }),
    ]);
    const [main, placed] = pair(board);
    expect(laidInstanceSize(reader(board), placed, main)).toEqual({ width: 300, height: 70 });
    const stacked = boardOf([
      component('main', { width: 100, height: 40, autoLayout: ROW }),
      shape('leaf', 'main', { width: 40, height: 24 }),
      instance('inst', 'main', {
        width: 100,
        height: 200,
        isHeightFixed: true,
        overrides: { main: { autoLayout: { gap: 10 } } },
      }),
    ]);
    const [stackMain, stackPlaced] = pair(stacked);
    expect(laidInstanceSize(reader(stacked), stackPlaced, stackMain)).toEqual({
      width: 44,
      height: 200,
    });
  });
});

describe('resolveInstanceChild geometry fallback', () => {
  it.each(['x', 'y', 'width', 'height', 'autoLayout'] as const)(
    'requests full resolution for a child record setting %s',
    (field) => {
      const value = field === 'autoLayout' ? { gap: 3 } : 12;
      const board = boardOf([
        component('main'),
        shape('leaf', 'main'),
        instance('inst', 'main', { overrides: { leaf: { [field]: value } } }),
      ]);
      expect(resolveInstanceChild(board, pair(board)[1], id('leaf'))).toBeUndefined();
    },
  );

  it.each(['x', 'y', 'width', 'height', 'autoLayout'] as const)(
    'requests full resolution for a root record setting %s',
    (field) => {
      const value = field === 'autoLayout' ? { gap: 3 } : 12;
      const board = boardOf([
        component('main'),
        shape('leaf', 'main'),
        instance('inst', 'main', { overrides: { main: { [field]: value } } }),
      ]);
      expect(resolveInstanceChild(board, pair(board)[1], id('leaf'))).toBeUndefined();
    },
  );

  it.each(['x', 'y', 'width', 'height', 'autoLayout'] as const)(
    'requests full resolution for an ancestor record setting %s',
    (field) => {
      const value = field === 'autoLayout' ? { gap: 3 } : 12;
      const board = boardOf([
        component('main'),
        frame('parent', 'main'),
        shape('leaf', 'parent'),
        instance('inst', 'main', {
          overrides: { parent: { [field]: value } },
        }),
      ]);
      expect(resolveInstanceChild(board, pair(board)[1], id('leaf'))).toBeUndefined();
    },
  );

  it('keeps the single-child path for content-only records', () => {
    const red: [number, number, number, number] = [1, 0, 0, 1];
    const board = boardOf([
      component('main'),
      shape('leaf', 'main'),
      instance('inst', 'main', { overrides: { leaf: { fill: red } } }),
    ]);
    expect(resolveInstanceChild(board, pair(board)[1], id('leaf'))).toMatchObject({
      kind: 'shown',
      object: { fill: red },
    });
  });
});
