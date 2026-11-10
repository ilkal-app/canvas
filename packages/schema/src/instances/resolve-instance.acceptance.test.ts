import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import { objectIdSchema } from '../ids/object-id.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import {
  boardOf,
  comment,
  component,
  frame,
  group,
  id,
  instance,
  instanceChain,
  shape,
  sticky,
} from './__fixtures__/component-board.js';
import { expectedExport } from './__fixtures__/expected-api.js';
import { byId, fullBoard, idsOf, RED, resolve } from './__fixtures__/resolved-board.js';

// Acceptance:
// `resolveInstance(board, instance)` expands an instance into virtual objects. A path is the
// chain of nested instance source ids from the main downwards, then the target's id; group and
// frame ancestors add no segment. Virtual ids are `<instanceId>/<path>`.

describe('resolveInstance virtual ids', () => {
  it('joins the instance id and the path with a slash, and the result is not an object id', () => {
    const virtualObjectId = expectedExport('virtualObjectId');
    expect(virtualObjectId(id('inst'), 'child-a')).toBe('inst/child-a');
    expect(virtualObjectId(id('inst'), 'nested/child')).toBe('inst/nested/child');
    expect(objectIdSchema.safeParse('inst/child-a').success).toBe(false);
    expect(objectIdSchema.safeParse(virtualObjectId(id('inst'), 'child-a')).success).toBe(false);
  });

  it('parents top-level objects to the instance and deeper ones to their virtual parent, with no segment for groups or frames', () => {
    const board = boardOf([
      component('main'),
      shape('child-a', 'main', { x: 30, y: 10 }),
      group('group', 'main', { x: 30, y: 40 }),
      shape('grouped', 'group'),
      frame('inner', 'main', { x: 100, y: 10 }),
      shape('framed', 'inner', { x: 5 }),
      instance('inst', 'main', { x: 500 }),
    ]);
    const { objects, issue, isMainRetired } = resolve(board);
    expect(issue).toBeUndefined();
    expect(isMainRetired).toBe(false);
    expect(idsOf(objects)).toEqual([
      'inst/child-a',
      'inst/framed',
      'inst/group',
      'inst/grouped',
      'inst/inner',
    ]);
    expect(byId(objects, 'inst/child-a').parentId).toBe('inst');
    expect(byId(objects, 'inst/group').parentId).toBe('inst');
    expect(byId(objects, 'inst/grouped').parentId).toBe('inst/group');
    expect(byId(objects, 'inst/inner').parentId).toBe('inst');
    expect(byId(objects, 'inst/framed').parentId).toBe('inst/inner');
  });

  it('copies z and constraints from the source child', () => {
    const constraints = { x: 'end', y: 'center' };
    const board = boardOf([
      component('main'),
      shape('child-a', 'main', { x: 30, y: 10, z: 'a3', constraints }),
      shape('child-b', 'main', { x: 100, y: 10, z: 'a1' }),
      instance('inst', 'main'),
    ]);
    const { objects } = resolve(board);
    expect(byId(objects, 'inst/child-a').z).toBe('a3');
    expect(byId(objects, 'inst/child-a').constraints).toEqual(constraints);
    expect(byId(objects, 'inst/child-b').z).toBe('a1');
    expect(byId(objects, 'inst/child-b').constraints).toBeUndefined();
  });

  it('maps children into the instance size by constrainChildren: a stretch child 20 wide at 30 becomes 120 wide at 300', () => {
    const board = boardOf([
      component('main'),
      shape('child-a', 'main', { x: 30, y: 10, constraints: { x: 'stretch', y: 'start' } }),
      shape('child-b', 'main', { x: 100, y: 10, constraints: { x: 'end', y: 'start' } }),
      instance('inst', 'main', { width: 300, height: 100 }),
    ]);
    const { objects } = resolve(board);
    expect(byId(objects, 'inst/child-a')).toMatchObject({ x: 30, y: 10, width: 120, height: 20 });
    expect(byId(objects, 'inst/child-b')).toMatchObject({ x: 200, y: 10, width: 20 });
  });

  it('keeps children at their source placement when the instance has the main size', () => {
    const { objects } = resolve(fullBoard());
    expect(byId(objects, 'inst/child-a')).toMatchObject({ x: 30, y: 10, width: 20, height: 20 });
    expect(byId(objects, 'inst/image')).toMatchObject({ x: 120, y: 40, width: 20, height: 20 });
  });
});

describe('resolveInstance nesting', () => {
  it('resolves a nested instance to inst/nested/child, and an outer override at nested/child applies to it', () => {
    const board = boardOf([
      component('main-a'),
      shape('child', 'main-a', { x: 30, y: 10 }),
      component('main-b', { x: 300 }),
      instance('nested', 'main-a', { parentId: 'main-b', x: 10, y: 0 }),
      shape('own', 'main-b', { x: 100, y: 10 }),
      instance('inst', 'main-b', { x: 600, overrides: { 'nested/child': { fill: RED } } }),
    ]);
    const { objects, issue } = resolve(board);
    expect(issue).toBeUndefined();
    expect(idsOf(objects)).toEqual(['inst/nested', 'inst/nested/child', 'inst/own']);
    expect(byId(objects, 'inst/nested').parentId).toBe('inst');
    expect(byId(objects, 'inst/nested/child')).toMatchObject({
      parentId: 'inst/nested',
      fill: RED,
      x: 30,
      y: 10,
    });
  });

  it('resolves a chain of five instances down to the leaf, and refuses six as instance-depth', () => {
    const five = resolve(boardOf(instanceChain(5)));
    expect(five.issue).toBeUndefined();
    expect(idsOf(five.objects)).toContain('inst/i4/i3/i2/i1/leaf');
    expect(byId(five.objects, 'inst/i4/i3/i2/i1/leaf').parentId).toBe('inst/i4/i3/i2/i1');
    const six = resolve(boardOf(instanceChain(6)));
    expect(six.issue).toBe('instance-depth');
    expect(six.isMainRetired).toBe(false);
  });

  it('reports instance-cycle and stops at the repeated main, keeping the objects above it', () => {
    const board = boardOf([
      component('main-a'),
      shape('child-a', 'main-a', { x: 30, y: 10 }),
      instance('nb', 'main-b', { parentId: 'main-a', x: 100, y: 10, width: 50, height: 50 }),
      component('main-b', { x: 300 }),
      shape('child-b', 'main-b', { x: 30, y: 10 }),
      instance('na', 'main-a', { parentId: 'main-b', x: 100, y: 10, width: 50, height: 50 }),
      instance('inst', 'main-a', { x: 600 }),
    ]);
    const { objects, issue } = resolve(board);
    expect(issue).toBe('instance-cycle');
    const ids = idsOf(objects);
    expect(ids).toContain('inst/child-a');
    expect(ids).toContain('inst/nb');
    expect(ids).toContain('inst/nb/child-b');
    expect(ids.some((virtualId) => virtualId.startsWith('inst/nb/na/'))).toBe(false);
  });
});

describe('resolveInstance omissions and remapping', () => {
  it('omits comments inside the main', () => {
    const board = boardOf([
      component('main'),
      shape('child-a', 'main', { x: 30, y: 10 }),
      comment('comment', 'main', 'child-a'),
      comment('free', 'main', 'child-a', { anchor: { kind: 'point' }, x: 150, y: 80 }),
      instance('inst', 'main'),
    ]);
    expect(idsOf(resolve(board).objects)).toEqual(['inst/child-a']);
  });

  it('remaps a connector attached to two siblings to their virtual ids', () => {
    const { objects } = resolve(fullBoard());
    const resolved = byId(objects, 'inst/conn');
    expect(resolved.parentId).toBe('inst');
    expect(resolved.from).toEqual({
      kind: 'object',
      objectId: 'inst/child-a',
      anchor: { x: 1, y: 0.5 },
    });
    expect(resolved.to).toEqual({ kind: 'object', objectId: 'inst/child-b', anchor: null });
  });
});

describe('resolveInstance mains', () => {
  it('answers no objects and missing-main for an instance whose main is not on the board', () => {
    const board = boardOf([instance('inst', 'gone')]);
    expect(resolve(board)).toEqual({ objects: [], issue: 'missing-main', isMainRetired: false });
  });

  it('answers no objects and invalid-main for an instance whose main is a sticky', () => {
    const board = boardOf([sticky('note', null), instance('inst', 'note')]);
    expect(resolve(board)).toEqual({ objects: [], issue: 'invalid-main', isMainRetired: false });
  });

  it('still resolves every object of a retired main and reports isMainRetired', () => {
    const board = boardOf([
      component('main', { retired: true }),
      shape('child-a', 'main', { x: 30, y: 10 }),
      group('group', 'main', { x: 30, y: 40 }),
      shape('grouped', 'group'),
      instance('inst', 'main'),
    ]);
    const { objects, issue, isMainRetired } = resolve(board);
    expect(issue).toBeUndefined();
    expect(isMainRetired).toBe(true);
    expect(idsOf(objects)).toEqual(['inst/child-a', 'inst/group', 'inst/grouped']);
  });
});

describe('resolveInstance geometry and purity', () => {
  it('holds the sticky floor: a y stretch into a shorter instance keeps the source height', () => {
    const board = boardOf([
      component('main'),
      sticky('sticky', 'main', { x: 30, y: 10, constraints: { x: 'start', y: 'stretch' } }),
      instance('inst', 'main', { width: 200, height: 90 }),
    ]);
    expect(byId(resolve(board).objects, 'inst/sticky')).toMatchObject({ y: 10, height: 20 });
  });

  it('never mutates the board it is given', () => {
    const build = (): Board =>
      fullBoard({
        width: 300,
        height: 150,
        overrides: { 'child-a': { fill: RED }, group: { isHidden: true } },
      });
    const board = deepFreeze(build());
    resolve(board);
    expect(board).toEqual(build());
  });
});
