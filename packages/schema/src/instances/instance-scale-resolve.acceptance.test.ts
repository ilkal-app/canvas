import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import { buildChildIndex } from '../board/child-index.js';
import type { ComponentObject } from '../objects/component-object.js';
import type { InstanceObject } from '../objects/instance-object.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import { boardOf, component, id, instance, shape, text } from './__fixtures__/component-board.js';
import { byId, RED, resolve } from './__fixtures__/resolved-board.js';
import { laidInstanceSize } from './instance-layout.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

function size(board: Board, name = 'inst') {
  const children = buildChildIndex(board);
  const reader = {
    get: (objectId: ReturnType<typeof id>) => board.objects.get(objectId),
    childrenOf: (objectId: ReturnType<typeof id>) => children.get(objectId) ?? [],
  };
  return laidInstanceSize(
    reader,
    board.objects.get(id(name)) as InstanceObject,
    board.objects.get(id('main')) as ComponentObject,
  );
}

describe('scaled instance resolution', () => {
  it('resolves content in box / scale main units, then scales the drawn copy', () => {
    const board = deepFreeze(
      boardOf([
        component('main', { width: 100, height: 50 }),
        shape('child', 'main', { x: 10, y: 10, width: 20, height: 20 }),
        instance('inst', 'main', { width: 200, height: 100, scale: 2 }),
      ]),
    );
    const { objects } = resolve(board);
    expect(byId(objects, 'inst/child')).toMatchObject({
      x: 20,
      y: 20,
      width: 40,
      height: 40,
      stroke: { width: 4 },
    });
    expect(board.objects.get(id('child'))).toMatchObject({ x: 10, y: 10, width: 20 });
  });

  it('runs stretch constraints in main units before scaling', () => {
    const board = boardOf([
      component('main', { width: 100, height: 50 }),
      shape('child', 'main', {
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        constraints: { x: 'stretch', y: 'start' },
      }),
      instance('inst', 'main', { width: 300, height: 100, scale: 2 }),
    ]);
    expect(byId(resolve(board).objects, 'inst/child')).toMatchObject({
      x: 20,
      y: 20,
      width: 140,
      height: 40,
      stroke: { width: 4 },
    });
  });

  it('lays out a hugging axis in main units and scales its reported size', () => {
    const board = boardOf([
      component('main', { width: 100, height: 50, autoLayout: ROW }),
      shape('first', 'main', { width: 20, height: 20, z: 'a0' }),
      shape('second', 'main', { width: 30, height: 20, z: 'a1' }),
      instance('inst', 'main', { width: 100, height: 50, scale: 2 }),
    ]);
    expect(byId(resolve(board).objects, 'inst/first')).toMatchObject({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
    expect(byId(resolve(board).objects, 'inst/second')).toMatchObject({
      x: 70,
      y: 10,
      width: 60,
      height: 40,
    });
    expect(size(board)).toEqual({ width: 140, height: 60 });
  });

  it('keeps a fixed axis at the instance drawn size exactly, including a fractional box', () => {
    const board = boardOf([
      component('main', { width: 100, height: 50, autoLayout: ROW }),
      shape('child', 'main', { width: 30, height: 20 }),
      instance('inst', 'main', { width: 123.4567, height: 50, scale: 0.3, isWidthFixed: true }),
    ]);
    expect(size(board)).toEqual({ width: 123.4567, height: 9 });
  });

  it('composes an inner 0.5 scale with an outer 2 scale', () => {
    const board = boardOf([
      component('inner-main', { width: 100, height: 50 }),
      shape('leaf', 'inner-main', { x: 10, y: 10, width: 20, height: 20 }),
      component('main', { width: 100, height: 50 }),
      instance('nested', 'inner-main', { parentId: id('main'), width: 50, height: 25, scale: 0.5 }),
      instance('inst', 'main', { width: 200, height: 100, scale: 2 }),
    ]);
    expect(byId(resolve(board, 'nested').objects, 'nested/leaf')).toMatchObject({
      x: 5,
      y: 5,
      width: 10,
      height: 10,
      stroke: { width: 1 },
    });
    expect(byId(resolve(board).objects, 'inst/nested/leaf')).toMatchObject({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      stroke: { width: 2 },
    });
  });

  it('keeps nested instance override records in main units in a resolved copy', () => {
    const overrides = { leaf: { text: 'Long', measuredSize: { width: 30, height: 12 } } };
    const board = boardOf([
      component('inner-main', { width: 100, height: 50 }),
      text('leaf', 'inner-main'),
      component('main', { width: 100, height: 50 }),
      instance('nested', 'inner-main', { parentId: id('main'), overrides }),
      instance('inst', 'main', { width: 200, height: 100, scale: 2 }),
    ]);
    expect(byId(resolve(board).objects, 'inst/nested').overrides).toEqual(overrides);
  });

  it('applies a fill override before scaling the virtual child', () => {
    const board = boardOf([
      component('main', { width: 100, height: 50 }),
      shape('child', 'main', { x: 10, width: 20 }),
      instance('inst', 'main', {
        width: 200,
        height: 100,
        scale: 2,
        overrides: { child: { fill: RED } },
      }),
    ]);
    expect(byId(resolve(board).objects, 'inst/child')).toMatchObject({
      x: 20,
      width: 40,
      fill: RED,
      stroke: { width: 4 },
    });
  });

  it('scales a text override measuredSize with the text copy', () => {
    const board = boardOf([
      component('main', { width: 100, height: 50, autoLayout: ROW }),
      text('label', 'main', { width: 20, height: 10 }),
      instance('inst', 'main', {
        width: 200,
        height: 100,
        scale: 2,
        overrides: { label: { text: 'Long', measuredSize: { width: 30, height: 12 } } },
      }),
    ]);
    expect(byId(resolve(board).objects, 'inst/label')).toMatchObject({
      text: 'Long',
      x: 10,
      y: 10,
      width: 60,
      height: 24,
      runs: [{ style: { fontSize: 48 } }],
    });
    expect(size(board)).toEqual({ width: 80, height: 44 });
  });
});
