import { describe, expect, it } from 'vitest';

import { boardOf, component, frame, instance, shape } from './__fixtures__/component-board.js';
import { byId, resolve } from './__fixtures__/resolved-board.js';

// An instance's content laid out with its own records, where the acceptance tests
// do not reach: an auto-layout frame inside a main without one, a resized box carrying its own
// children, and a main without auto-layout resolving as before.

/** A row that hugs both axes, 10 apart, padded 5 all round. */
const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

describe('an instance’s auto-layout content', () => {
  it('lays out an auto-layout frame inside a main without one, with the instance’s records', () => {
    const board = boardOf([
      component('main', { width: 200, height: 100 }),
      frame('row', 'main', { x: 10, y: 10, width: 100, height: 30, autoLayout: ROW }),
      shape('a', 'row', { width: 40, height: 20, z: 'a0', x: 5, y: 5 }),
      shape('b', 'row', { width: 30, height: 20, z: 'a1', x: 55, y: 5 }),
      instance('inst', 'main', { overrides: { a: { isHidden: true } } }),
    ]);
    const { objects } = resolve(board);
    // The row keeps its place in the main and hugs what is left: b alone, padded.
    expect(byId(objects, 'inst/row')).toMatchObject({ x: 10, y: 10, width: 40, height: 30 });
    expect(byId(objects, 'inst/b')).toMatchObject({ x: 5, y: 5 });
    expect(objects.some(({ id }) => id === 'inst/a')).toBe(false);
  });

  it('carries the children of a box the layout resizes to its new size', () => {
    const board = boardOf([
      component('main', {
        width: 100,
        height: 60,
        autoLayout: { ...ROW, width: 'fixed', height: 'fixed' },
      }),
      frame('panel', 'main', { width: 40, height: 50, z: 'a0', layoutChild: { fill: true } }),
      shape('corner', 'panel', {
        width: 10,
        height: 10,
        x: 30,
        y: 0,
        constraints: { x: 'end', y: 'start' },
      }),
      instance('inst', 'main', { width: 200, height: 60 }),
    ]);
    const { objects } = resolve(board);
    // The panel fills the instance's width less padding, and its pinned child follows its edge.
    expect(byId(objects, 'inst/panel')).toMatchObject({ x: 5, width: 190 });
    expect(byId(objects, 'inst/corner')).toMatchObject({ x: 180, y: 0 });
  });

  it('resolves a main without auto-layout by its constraints alone, as before', () => {
    const board = boardOf([
      component('main', { width: 100, height: 50 }),
      shape('a', 'main', { x: 10, y: 10, width: 20, height: 20 }),
      shape('b', 'main', { x: 40, y: 10, width: 20, height: 20 }),
      instance('inst', 'main', { width: 100, height: 50, overrides: { a: { isHidden: true } } }),
    ]);
    const { objects } = resolve(board);
    // A hidden child leaves a gap: only auto-layout closes it.
    expect(byId(objects, 'inst/b')).toMatchObject({ x: 40, y: 10 });
  });
});
