// Stored visibility participates in instance resolution and live auto-layout.
import { describe, expect, it } from 'vitest';

import { buildChildIndex } from '../board/child-index.js';
import type { Board, BoardObject, ComponentObject, ObjectId } from '../index.js';
import { layOutStack } from '../layout/stack-layout.js';

import { boardOf, component, frame, id, instance, shape } from './__fixtures__/component-board.js';
import { resolve } from './__fixtures__/resolved-board.js';
import { autoLayoutTree } from './instance-layout.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

function reader(board: Board) {
  const children = buildChildIndex(board);
  return {
    get: (objectId: ObjectId): BoardObject | undefined => board.objects.get(objectId),
    childrenOf: (objectId: ObjectId): Iterable<ObjectId> => children.get(objectId) ?? [],
  };
}

function mainOf(board: Board): ComponentObject {
  return board.objects.get(id('main')) as ComponentObject;
}

describe('instance stored visibility', () => {
  it('omits a main child stored hidden', () => {
    const board = boardOf([
      component('main'),
      shape('child', 'main', { isHidden: true }),
      instance('inst', 'main'),
    ]);
    expect(resolve(board).objects.map(({ id: objectId }) => objectId)).not.toContain('inst/child');
  });

  it('an own false record shows a main child stored hidden', () => {
    const board = boardOf([
      component('main'),
      shape('child', 'main', { isHidden: true }),
      instance('inst', 'main', { overrides: { child: { isHidden: false } } }),
    ]);
    expect(resolve(board).objects.map(({ id: objectId }) => objectId)).toContain('inst/child');
  });

  it('a selected variant false record shows a main child stored hidden', () => {
    const board = boardOf([
      component('main', {
        variantAxes: [{ name: 'State', values: ['Default', 'Shown'] }],
        variantPresets: { 'State=Shown': { child: { isHidden: false } } },
      }),
      shape('child', 'main', { isHidden: true }),
      instance('inst', 'main', { variant: { State: 'Shown' } }),
    ]);
    expect(resolve(board).objects.map(({ id: objectId }) => objectId)).toContain('inst/child');
  });

  it('a true record hides a shown main child', () => {
    const board = boardOf([
      component('main'),
      shape('child', 'main'),
      instance('inst', 'main', { overrides: { child: { isHidden: true } } }),
    ]);
    expect(resolve(board).objects.map(({ id: objectId }) => objectId)).not.toContain('inst/child');
  });

  it('a hidden container hides its descendants even with a child false record', () => {
    const board = boardOf([
      component('main'),
      frame('container', 'main', { isHidden: true }),
      shape('child', 'container'),
      instance('inst', 'main', { overrides: { child: { isHidden: false } } }),
    ]);
    expect(resolve(board).objects.map(({ id: objectId }) => objectId)).not.toContain('inst/child');
  });
});

describe('stored visibility in auto-layout', () => {
  it('closes the hidden middle gap and excludes its width from a hugging component', () => {
    const board = boardOf([
      component('main', { autoLayout: ROW }),
      shape('first', 'main', { width: 20, height: 20, z: 'a0' }),
      shape('middle', 'main', { width: 100, height: 20, z: 'a1', isHidden: true }),
      shape('last', 'main', { width: 30, height: 20, z: 'a2' }),
    ]);
    const tree = autoLayoutTree(reader(board), mainOf(board));
    if (tree === undefined) throw new Error('missing auto-layout tree');
    const placed = layOutStack(tree);
    expect(placed.find(({ key }) => key === 'middle')).toBeUndefined();
    expect(placed.find(({ key }) => key === 'last')?.x).toBe(35);
    expect(placed.find(({ key }) => key === 'main')?.width).toBe(70);
  });
});
