import { describe, expect, it } from 'vitest';

import type { InstanceObject } from '../objects/instance-object.js';

import {
  boardOf,
  component,
  frame,
  group,
  id,
  instance,
  mainChildren,
  shape,
} from './__fixtures__/component-board.js';
import { resolveInstanceChild } from './resolve-instance-child.js';
import { resolveInstance } from './resolve-instance.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];

/** A main, its children (incl. a frame chain), and instances at several sizes with overrides. */
const objects = [
  component('main', { width: 200, height: 100 }),
  ...mainChildren(),
  frame('deep', 'inner', {
    x: 2,
    y: 2,
    width: 8,
    height: 8,
    constraints: { x: 'end', y: 'stretch' },
  }),
  shape('deepest', 'deep', {
    x: 1,
    y: 1,
    width: 4,
    height: 4,
    constraints: { x: 'stretch', y: 'end' },
  }),
  shape('pinned', 'main', {
    x: 150,
    y: 60,
    width: 20,
    height: 20,
    constraints: { x: 'end', y: 'center' },
  }),
];
const placements: InstanceObject[] = [
  instance('same', 'main'),
  instance('wide', 'main', { width: 420, height: 160 }),
  instance('narrow', 'main', { width: 90, height: 60 }),
  instance('styled', 'main', {
    width: 300,
    overrides: {
      'child-b': { fill: RED },
      sticky: { text: 'Hi', color: RED },
      framed: { strokeColor: RED },
      inner: { isHidden: true },
    },
  }),
] as InstanceObject[];
const same = instance('same', 'main') as InstanceObject;

describe('resolveInstanceChild', () => {
  const board = boardOf([...objects, ...placements]);

  it.each(placements.map((p) => [p.id, p]))(
    'equals resolveInstance for every patchable child of %s',
    (name, placement) => {
      const full = new Map(resolveInstance(board, placement).objects.map((o) => [o.id, o]));
      let patched = 0;
      for (const child of objects.slice(1)) {
        const one = resolveInstanceChild(board, placement, child.id);
        if (one === undefined) continue;
        patched += 1;
        const virtual = full.get(id(`${placement.id}/${child.id}`));
        if (one.kind === 'hidden') expect(virtual).toBeUndefined();
        else expect(one.object).toEqual(virtual);
      }
      expect(patched).toBeGreaterThan(6);
    },
  );

  it('refuses containers, connectors, comments and children under a group', () => {
    const placement = same;
    for (const childId of ['group', 'grouped', 'inner', 'conn', 'comment']) {
      expect(resolveInstanceChild(board, placement, id(childId))).toBeUndefined();
    }
  });

  it('refuses a child outside the main and a missing main', () => {
    const outside = boardOf([...objects, group('loose', null), shape('stray', 'loose')]);
    expect(resolveInstanceChild(outside, same, id('stray'))).toBeUndefined();
    const orphan = instance('orphan', 'gone') as InstanceObject;
    expect(resolveInstanceChild(board, orphan, id('child-a'))).toBeUndefined();
  });
});
