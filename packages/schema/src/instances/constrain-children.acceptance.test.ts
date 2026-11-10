import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import type { BoardObject } from '../objects/board-object.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import {
  boardOf,
  component,
  frame,
  group,
  id,
  image,
  line,
  shape,
  sticky,
  text,
  type Fields,
} from './__fixtures__/component-board.js';
import { expectedExport, type BoxSize, type ConstraintMode } from './__fixtures__/expected-api.js';

// Acceptance:
// `constrainChildren(board, parent, to)` rewrites every descendant of a component, frame or
// instance box by its own constraints, pure. The main is 200 by 100; the child is 20 wide at
// x 30 (start inset a = 30, end inset b = 150) or 20 tall at y 30 (a = 30, b = 50).

/** A resolved or rewritten object with its fields readable without narrowing on `type`. */
type Loose = BoardObject & Readonly<Record<string, unknown>>;

const MODES: readonly ConstraintMode[] = ['start', 'center', 'end', 'stretch'];
const ROTATION = Math.PI / 6;

/**
 * Resizes a parent of the board with `constrainChildren`.
 *
 * @param board - The board.
 * @param parentId - The component, frame or instance to resize.
 * @param to - Its new size.
 * @returns The rewritten descendants.
 * @throws {Error} When the fixture has no such parent.
 */
function resize(board: Board, parentId: string, to: BoxSize): Loose[] {
  const parent = board.objects.get(id(parentId));
  if (parent === undefined) throw new Error(`no parent "${parentId}" in the fixture`);
  return expectedExport('constrainChildren')(board, parent, to).map((object) => object as Loose);
}

/**
 * One object of a result by id.
 *
 * @param objects - The result.
 * @param objectId - The id to find.
 * @returns The object.
 * @throws {Error} When the result has no object with that id.
 */
function byId(objects: readonly Loose[], objectId: string): Loose {
  const found = objects.find((object) => object.id === objectId);
  if (found === undefined) throw new Error(`"${objectId}" is not in the result`);
  return found;
}

/**
 * A main of the given size holding one shape child.
 *
 * @param main - The main's size.
 * @param child - The child's placement and constraints.
 * @returns The board.
 */
function mainWith(main: Fields, child: Fields): Board {
  return boardOf([component('main', main), shape('child', 'main', child)]);
}

/**
 * The child of a 200 by 100 main, 20 by 20 at (30, 30), after the main is resized.
 *
 * @param constraints - The child's constraints.
 * @param to - The main's new size.
 * @returns The rewritten child.
 */
function childAfter(constraints: Fields, to: BoxSize): Loose {
  const board = mainWith({}, { x: 30, y: 30, constraints });
  return byId(resize(board, 'main', to), 'child');
}

describe('constrainChildren along x (a = 30, b = 150, span 200)', () => {
  it.each([
    { mode: 'start', width: 300, x: 30, childWidth: 20 },
    { mode: 'start', width: 100, x: 30, childWidth: 20 },
    { mode: 'start', width: 0, x: 30, childWidth: 20 },
    { mode: 'end', width: 300, x: 130, childWidth: 20 },
    { mode: 'end', width: 100, x: -70, childWidth: 20 },
    { mode: 'end', width: 0, x: -170, childWidth: 20 },
    { mode: 'center', width: 300, x: 80, childWidth: 20 },
    { mode: 'center', width: 100, x: -20, childWidth: 20 },
    { mode: 'center', width: 0, x: -70, childWidth: 20 },
    { mode: 'stretch', width: 300, x: 30, childWidth: 120 },
    { mode: 'stretch', width: 100, x: 30, childWidth: 0 },
    { mode: 'stretch', width: 0, x: 30, childWidth: 0 },
  ])('$mode: width 200 to $width puts the child at x $x, $childWidth wide', (row) => {
    const child = childAfter({ x: row.mode, y: 'start' }, { width: row.width, height: 100 });
    expect(child.x).toBe(row.x);
    expect(child.width).toBe(row.childWidth);
    expect(child.y).toBe(30);
    expect(child.height).toBe(20);
  });
});

describe('constrainChildren along y (a = 30, b = 50, span 100)', () => {
  it.each([
    { mode: 'start', height: 150, y: 30, childHeight: 20 },
    { mode: 'start', height: 60, y: 30, childHeight: 20 },
    { mode: 'start', height: 0, y: 30, childHeight: 20 },
    { mode: 'end', height: 150, y: 80, childHeight: 20 },
    { mode: 'end', height: 60, y: -10, childHeight: 20 },
    { mode: 'end', height: 0, y: -70, childHeight: 20 },
    { mode: 'center', height: 150, y: 55, childHeight: 20 },
    { mode: 'center', height: 60, y: 10, childHeight: 20 },
    { mode: 'center', height: 0, y: -20, childHeight: 20 },
    { mode: 'stretch', height: 150, y: 30, childHeight: 70 },
    { mode: 'stretch', height: 60, y: 30, childHeight: 0 },
    { mode: 'stretch', height: 0, y: 30, childHeight: 0 },
  ])('$mode: height 100 to $height puts the child at y $y, $childHeight tall', (row) => {
    const child = childAfter({ x: 'start', y: row.mode }, { width: 200, height: row.height });
    expect(child.y).toBe(row.y);
    expect(child.height).toBe(row.childHeight);
    expect(child.x).toBe(30);
    expect(child.width).toBe(20);
  });
});

describe('constrainChildren edge cases', () => {
  it('keeps both insets of an overhanging child under stretch: x -10 and 300 wide in 200 becomes 500 wide at 400', () => {
    const board = mainWith({}, { x: -10, width: 300, constraints: { x: 'stretch', y: 'start' } });
    const child = byId(resize(board, 'main', { width: 400, height: 100 }), 'child');
    expect(child.x).toBe(-10);
    expect(child.width).toBe(500);
  });

  it.each(MODES)('acts as start on an axis whose source span is 0 (mode %s)', (mode) => {
    const board = mainWith({ width: 0 }, { x: 30, constraints: { x: mode, y: 'start' } });
    const child = byId(resize(board, 'main', { width: 300, height: 100 }), 'child');
    expect(child.x).toBe(30);
    expect(child.width).toBe(20);
  });

  it('translates a rotated child by its pins and keeps its size and rotation', () => {
    const rotated = { x: 30, y: 10, rotation: ROTATION };
    const after = (mode: ConstraintMode): Loose => {
      const board = mainWith({}, { ...rotated, constraints: { x: mode, y: 'start' } });
      return byId(resize(board, 'main', { width: 300, height: 100 }), 'child');
    };
    expect(after('start').x).toBeCloseTo(30, 9);
    expect(after('end').x).toBeCloseTo(130, 9);
    expect(after('center').x).toBeCloseTo(80, 9);
    for (const child of MODES.map(after)) {
      expect(child.y).toBeCloseTo(10, 9);
      expect(child.width).toBe(20);
      expect(child.height).toBe(20);
      expect(child.rotation).toBe(ROTATION);
    }
  });

  it('treats stretch on a rotated child as center, width unchanged', () => {
    const constraints = { x: 'stretch', y: 'start' };
    const board = mainWith({}, { x: 30, y: 10, rotation: ROTATION, constraints });
    const child = byId(resize(board, 'main', { width: 300, height: 100 }), 'child');
    expect(child.x).toBeCloseTo(80, 9);
    expect(child.y).toBeCloseTo(10, 9);
    expect(child.width).toBe(20);
    expect(child.rotation).toBe(ROTATION);
  });
});

describe('constrainChildren containers', () => {
  it('stretches a group by its own constraints and scales its interior proportionally, ignoring the members constraints', () => {
    const board = boardOf([
      component('main'),
      group('group', 'main', { x: 30, y: 10, constraints: { x: 'stretch', y: 'start' } }),
      shape('grouped', 'group', { x: 0, y: 0, constraints: { x: 'end', y: 'end' } }),
      shape('grouped-b', 'group', { x: 10, y: 0, width: 5, height: 5 }),
    ]);
    const result = resize(board, 'main', { width: 220, height: 100 });
    expect(byId(result, 'group')).toMatchObject({ x: 30, y: 10 });
    expect(byId(result, 'grouped')).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
    expect(byId(result, 'grouped-b')).toMatchObject({ x: 20, y: 0, width: 10, height: 5 });
  });

  it('boxes a nested frame by its constraints and lays out its children relative to its new box', () => {
    const board = boardOf([
      component('main'),
      frame('inner', 'main', { x: 30, y: 10, constraints: { x: 'stretch', y: 'start' } }),
      shape('framed', 'inner', { x: 5, width: 10, constraints: { x: 'stretch', y: 'start' } }),
      shape('framed-end', 'inner', { x: 5, width: 10, constraints: { x: 'end', y: 'start' } }),
      shape('framed-start', 'inner', { x: 5, width: 10 }),
    ]);
    const result = resize(board, 'main', { width: 300, height: 100 });
    expect(byId(result, 'inner')).toMatchObject({ x: 30, y: 10, width: 120, height: 50 });
    expect(byId(result, 'framed')).toMatchObject({ x: 5, width: 110 });
    expect(byId(result, 'framed-end')).toMatchObject({ x: 105, width: 10 });
    expect(byId(result, 'framed-start')).toMatchObject({ x: 5, width: 10 });
  });
});

describe('constrainChildren by object type', () => {
  it('scales a line along the stretched axis only', () => {
    const board = boardOf([
      component('main'),
      line('line', 'main', { x: 30, y: 70, constraints: { x: 'stretch', y: 'start' } }),
    ]);
    const after = byId(resize(board, 'main', { width: 300, height: 100 }), 'line');
    expect(after.x).toBe(30);
    expect(after.y).toBe(70);
    expect(after.points).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 10 },
    ]);
    expect(after.stroke).toEqual({ color: [0.1, 0.1, 0.12, 1], width: 2 });
  });

  it('gives an image the new box and leaves its crop and natural size alone', () => {
    const crop = { x: 0.1, y: 0, width: 0.8, height: 1 };
    const board = boardOf([
      component('main'),
      image('image', 'main', { x: 30, y: 10, crop, constraints: { x: 'stretch', y: 'start' } }),
    ]);
    const after = byId(resize(board, 'main', { width: 300, height: 100 }), 'image');
    expect(after).toMatchObject({ x: 30, width: 120, height: 20 });
    expect(after.crop).toEqual(crop);
    expect(after.naturalSize).toEqual({ width: 100, height: 100 });
  });

  it('keeps an auto-width text auto-width', () => {
    const board = boardOf([
      component('main'),
      text('text', 'main', { x: 30, y: 10, constraints: { x: 'stretch', y: 'start' } }),
    ]);
    const after = byId(resize(board, 'main', { width: 300, height: 100 }), 'text');
    expect(after.autoWidth).toBe(true);
    expect(after.x).toBe(30);
  });

  it('never shrinks a sticky below its source height under a y stretch, and grows it', () => {
    const board = boardOf([
      component('main'),
      sticky('sticky', 'main', { x: 30, y: 10, constraints: { x: 'start', y: 'stretch' } }),
    ]);
    const shrunk = byId(resize(board, 'main', { width: 200, height: 90 }), 'sticky');
    expect(shrunk).toMatchObject({ y: 10, height: 20 });
    const grown = byId(resize(board, 'main', { width: 200, height: 200 }), 'sticky');
    expect(grown).toMatchObject({ y: 10, height: 120 });
  });

  it.each(MODES)('never changes a font size or a stroke width (mode %s)', (mode) => {
    const constraints = { x: mode, y: mode };
    const board = boardOf([
      component('main'),
      text('text', 'main', { x: 30, y: 10, constraints }),
      shape('shape', 'main', { x: 30, y: 40, constraints }),
      line('line', 'main', { x: 30, y: 70, constraints }),
    ]);
    const result = resize(board, 'main', { width: 300, height: 200 });
    expect(byId(result, 'text').runs).toEqual([
      { length: 2, style: expect.objectContaining({ fontSize: 24 }) as object },
    ]);
    expect(byId(result, 'shape').stroke).toEqual({ color: [0.1, 0.1, 0.12, 1], width: 2 });
    expect(byId(result, 'line').stroke).toEqual({ color: [0.1, 0.1, 0.12, 1], width: 2 });
  });
});

describe('constrainChildren purity', () => {
  it('returns every descendant, the unchanged ones deep-equal to their input', () => {
    const plain = shape('plain', 'main', { x: 30, y: 10 });
    const pinned = shape('pinned', 'main', {
      x: 30,
      y: 10,
      constraints: { x: 'start', y: 'start' },
    });
    const board = boardOf([
      component('main'),
      plain,
      pinned,
      shape('moving', 'main', { x: 30, y: 10, constraints: { x: 'end', y: 'start' } }),
      group('group', 'main', { x: 30, y: 10 }),
      shape('grouped', 'group'),
    ]);
    const result = resize(board, 'main', { width: 300, height: 100 });
    expect(result.map((object) => object.id).sort()).toEqual(
      ['plain', 'pinned', 'moving', 'group', 'grouped'].sort(),
    );
    expect(byId(result, 'plain')).toEqual(plain);
    expect(byId(result, 'pinned')).toEqual(pinned);
    expect(byId(result, 'moving').x).toBe(130);
  });

  it('never mutates the board it is given', () => {
    const build = (): Board =>
      boardOf([
        component('main'),
        shape('child', 'main', { x: 30, y: 10, constraints: { x: 'stretch', y: 'stretch' } }),
        group('group', 'main', { x: 30, y: 40, constraints: { x: 'stretch', y: 'start' } }),
        line('line', 'group', { x: 0, y: 0 }),
      ]);
    const board = deepFreeze(build());
    resize(board, 'main', { width: 300, height: 200 });
    expect(board).toEqual(build());
  });
});
