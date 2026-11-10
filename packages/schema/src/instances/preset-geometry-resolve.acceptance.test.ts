// Acceptance
import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import {
  boardOf,
  component,
  frame,
  id,
  instance,
  shape,
  text,
} from './__fixtures__/component-board.js';
import { byId, resolve } from './__fixtures__/resolved-board.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
} as const;
const RED: [number, number, number, number] = [1, 0, 0, 1];

describe('preset geometry resolution', () => {
  it('draws ToolButton icon=24 from one icon slot at the main size and a larger instance size', () => {
    const main = component('button', {
      width: 40,
      height: 40,
      variantAxes: [{ name: 'Icon', values: ['20', '24'] }],
      variantPresets: { 'Icon=24': { icon: { x: 8, y: 8, width: 24, height: 24 } } },
    });
    const icon = shape('icon', 'button', {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      constraints: { x: 'end', y: 'end' },
    });
    const defaultButton = instance('default', 'button', { width: 40, height: 40 });
    const selected = instance('selected', 'button', {
      width: 40,
      height: 40,
      variant: { Icon: '24' },
    });
    const larger = instance('larger', 'button', { width: 60, height: 60, variant: { Icon: '24' } });
    const board = boardOf([main, icon, defaultButton, selected, larger]);
    expect(byId(resolve(board, 'default').objects, 'default/icon')).toMatchObject({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
    expect(byId(resolve(board, 'selected').objects, 'selected/icon')).toMatchObject({
      x: 8,
      y: 8,
      width: 24,
      height: 24,
    });
    expect(byId(resolve(board, 'larger').objects, 'larger/icon')).toMatchObject({
      x: 28,
      y: 28,
      width: 24,
      height: 24,
    });
    expect(
      resolve(board, 'selected').objects.filter(({ id: objectId }) => objectId === 'selected/icon'),
    ).toHaveLength(1);
  });

  it('uses the root variant box before mapping constrained descendants to the instance', () => {
    const main = component('main', {
      width: 100,
      height: 100,
      variantAxes: [{ name: 'Size', values: ['Base', 'Wide'] }],
      variantPresets: {
        'Size=Wide': { main: { width: 160, height: 120 }, box: { x: 120, y: 80 } },
      },
    });
    const box = shape('box', 'main', {
      x: 70,
      y: 70,
      width: 20,
      height: 20,
      constraints: { x: 'end', y: 'end' },
    });
    const placed = instance('inst', 'main', { width: 200, height: 150, variant: { Size: 'Wide' } });
    const board = boardOf([main, box, placed]);
    expect(byId(resolve(board).objects, 'inst/box')).toMatchObject({
      x: 160,
      y: 110,
      width: 20,
      height: 20,
    });
  });

  it('lets an own geometry record win over the selected preset field by field', () => {
    const main = component('main', {
      width: 40,
      height: 40,
      variantAxes: [{ name: 'Icon', values: ['20', '24'] }],
      variantPresets: { 'Icon=24': { icon: { x: 8, y: 8, width: 24, height: 24 } } },
    });
    const placed = instance('inst', 'main', {
      width: 40,
      height: 40,
      variant: { Icon: '24' },
      overrides: { icon: { x: 9, width: 26 } },
    });
    const board = boardOf([main, shape('icon', 'main', { x: 10, y: 10 }), placed]);
    expect(byId(resolve(board).objects, 'inst/icon')).toMatchObject({
      x: 9,
      y: 8,
      width: 26,
      height: 24,
    });
  });

  it('lays a record-sized child into a stack and ignores its recorded x and y', () => {
    const board = boardOf([
      component('main', { width: 120, height: 40, autoLayout: ROW }),
      shape('first', 'main', { width: 20, height: 20, z: 'a0' }),
      shape('last', 'main', { width: 20, height: 20, z: 'a1' }),
      instance('inst', 'main', {
        width: 120,
        height: 40,
        overrides: { first: { x: 900, y: -200, width: 40 } },
      }),
    ]);
    const objects = resolve(board).objects;
    expect(byId(objects, 'inst/first')).toMatchObject({ x: 5, y: 5, width: 40 });
    expect(byId(objects, 'inst/last')).toMatchObject({ x: 55, y: 5 });
  });

  it('merges root and frame auto-layout patches over their stored layouts', () => {
    const board = boardOf([
      component('main', {
        width: 140,
        height: 100,
        autoLayout: ROW,
        variantAxes: [{ name: 'Flow', values: ['Row', 'Column'] }],
        variantPresets: {
          'Flow=Column': {
            main: {
              autoLayout: {
                direction: 'column',
                gap: 7,
                padding: { top: 2, right: 3, bottom: 4, left: 6 },
              },
            },
            inner: { autoLayout: { gap: 3 } },
          },
        },
      }),
      frame('inner', 'main', { width: 60, height: 50, z: 'a0', autoLayout: ROW }),
      shape('a', 'inner', { width: 10, height: 10, z: 'a0' }),
      shape('b', 'inner', { width: 10, height: 10, z: 'a1' }),
      shape('after', 'main', { width: 20, height: 10, z: 'a1' }),
      instance('inst', 'main', { width: 140, height: 100, variant: { Flow: 'Column' } }),
    ]);
    const objects = resolve(board).objects;
    expect(byId(objects, 'inst/inner')).toMatchObject({ x: 6, y: 2 });
    expect(byId(objects, 'inst/after')).toMatchObject({ x: 6, y: 59 });
    expect(byId(objects, 'inst/a')).toMatchObject({ x: 5, y: 5 });
    expect(byId(objects, 'inst/b')).toMatchObject({ x: 18, y: 5 });
  });

  it('ignores an autoLayout record on a frame without live auto-layout', () => {
    const board = boardOf([
      component('main'),
      frame('plain', 'main', { x: 10, y: 10, width: 80, height: 40 }),
      shape('a', 'plain', { x: 2, y: 3, z: 'a0' }),
      shape('b', 'plain', { x: 40, y: 3, z: 'a1' }),
      instance('inst', 'main', { overrides: { plain: { autoLayout: { gap: 20 } } } }),
    ]);
    const objects = resolve(board).objects;
    expect(byId(objects, 'inst/a')).toMatchObject({ x: 2, y: 3 });
    expect(byId(objects, 'inst/b')).toMatchObject({ x: 40, y: 3 });
  });

  it('constrains nested instance content to the size set by its outer record', () => {
    const inner = component('inner', { width: 40, height: 40 });
    const slot = instance('slot', 'inner', { parentId: id('outer'), width: 40, height: 40 });
    const outer = component('outer', { width: 100, height: 100 });
    const placed = instance('inst', 'outer', {
      width: 100,
      height: 100,
      overrides: { slot: { width: 80, height: 60 }, 'slot/leaf': { fill: RED } },
    });
    const board = boardOf([
      inner,
      shape('leaf', 'inner', {
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        constraints: { x: 'end', y: 'end' },
      }),
      outer,
      slot,
      placed,
    ]);
    const objects = resolve(board).objects;
    expect(byId(objects, 'inst/slot')).toMatchObject({ width: 80, height: 60 });
    expect(byId(objects, 'inst/slot/leaf')).toMatchObject({ x: 50, y: 30, fill: RED });
  });

  it('draws Avatar agent or person with one of each layer and no placeholders', () => {
    const main = component('avatar', {
      width: 40,
      height: 40,
      variantAxes: [{ name: 'Kind', values: ['person', 'agent'] }],
      variantPresets: {
        'Kind=person': { agent: { isHidden: true } },
        'Kind=agent': { initials: { isHidden: true } },
      },
    });
    const initials = text('initials', 'avatar');
    const agent = shape('agent', 'avatar');
    const person = instance('person', 'avatar', { width: 40, height: 40 });
    const robot = instance('robot', 'avatar', {
      width: 40,
      height: 40,
      variant: { Kind: 'agent' },
    });
    const board = boardOf([main, initials, agent, person, robot]);
    expect(resolve(board, 'person').objects.map(({ id: objectId }) => objectId)).toEqual([
      'person/initials',
    ]);
    expect(resolve(board, 'robot').objects.map(({ id: objectId }) => objectId)).toEqual([
      'robot/agent',
    ]);
  });

  it('does not mutate frozen mains, presets, records, or children while resolving', () => {
    const main = component('main', {
      width: 40,
      height: 40,
      variantAxes: [{ name: 'Size', values: ['20', '24'] }],
      variantPresets: { 'Size=24': { main: { width: 50 }, icon: { x: 8, width: 24 } } },
    });
    const placed = instance('inst', 'main', {
      width: 60,
      height: 40,
      variant: { Size: '24' },
      overrides: { icon: { y: 9 } },
    });
    const board = deepFreeze(boardOf([main, shape('icon', 'main'), placed]));
    const before = [...board.objects.values()];
    resolveInstance(board, placed);
    expect([...board.objects.values()]).toEqual(before);
  });
});
