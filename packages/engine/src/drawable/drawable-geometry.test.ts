import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import {
  frameObject,
  groupObject,
  shapeObject,
  sourceOf,
} from '../scene/__fixtures__/scene-objects.js';
import { lineObject, pathObject, stickyObject } from '../spatial/__fixtures__/spatial-objects.js';

import { hostileBoard } from './__fixtures__/hostile-board.js';
import { DRAWABLE_EXTENT } from './drawable-extent.js';
import { isDrawableIn, undrawableReasonOf } from './drawable-geometry.js';

/**
 * The reason an object is refused on a board of the given objects.
 *
 * @param object - The object.
 * @param others - The rest of the board (its ancestors).
 * @returns The reason, or undefined when it is drawable.
 */
function reasonOn(object: BoardObject, ...others: BoardObject[]): string | undefined {
  return undrawableReasonOf(object, sourceOf([object, ...others]));
}

describe('undrawableReasonOf', () => {
  it('refuses every hostile object of the board, for its reason, and draws every honest one', () => {
    const board = hostileBoard();
    const source = sourceOf(board.objects);
    for (const { object } of board.honest)
      expect(undrawableReasonOf(object, source)).toBeUndefined();
    const reasons = new Map(
      board.objects.flatMap((object) => {
        const reason = undrawableReasonOf(object, source);
        return reason === undefined ? [] : [[object.id, reason] as const];
      }),
    );
    expect(reasons).toEqual(board.undrawable);
  });

  it('refuses a number that is not finite anywhere the engine reads one', () => {
    const shape = shapeObject('s');
    expect(reasonOn({ ...shape, fill: [Number.NaN, 0, 0, 1] })).toBe('not-finite');
    expect(reasonOn({ ...shape, stroke: { color: [0, 0, 0, 1], width: Infinity } })).toBe(
      'not-finite',
    );
    expect(reasonOn({ ...shape, cornerRadius: Number.NaN })).toBe('not-finite');
    expect(reasonOn({ ...shape, rotation: -Infinity })).toBe('not-finite');
    const path = pathObject('p', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const [segment] = path.segments;
    if (segment === undefined) throw new Error('the fixture path has a segment');
    expect(reasonOn({ ...path, segments: [{ ...segment, hb: { x: 0, y: Number.NaN } }] })).toBe(
      'not-finite',
    );
    const sticky = stickyObject('n');
    const [run] = sticky.runs;
    if (run === undefined) throw new Error('the fixture sticky has a run');
    expect(
      reasonOn({ ...sticky, runs: [{ ...run, style: { ...run.style, fontSize: Number.NaN } }] }),
    ).toBe('not-finite');
  });

  it('refuses a negative size, stroke, corner or font size', () => {
    const shape = shapeObject('s');
    expect(reasonOn({ ...shape, height: -1 })).toBe('negative-size');
    expect(reasonOn({ ...shape, cornerRadius: -1 })).toBe('negative-size');
    expect(reasonOn(lineObject('l', { stroke: { color: [0, 0, 0, 1], width: -2 } }))).toBe(
      'negative-size',
    );
    const sticky = stickyObject('n');
    const [run] = sticky.runs;
    if (run === undefined) throw new Error('the fixture sticky has a run');
    expect(reasonOn({ ...sticky, runs: [{ ...run, style: { ...run.style, fontSize: -4 } }] })).toBe(
      'negative-size',
    );
  });

  it('draws an honest object at the board’s edge with its stroke, refuses one past the extent', () => {
    const bound = 2 ** 30;
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 64 };
    expect(reasonOn(shapeObject('edge', { x: bound, y: -bound, width: bound, stroke }))).toBe(
      undefined,
    );
    expect(reasonOn(shapeObject('past', { x: DRAWABLE_EXTENT, width: 1 }))).toBe('past-extent');
    expect(reasonOn(shapeObject('wide', { width: 2 ** 40 }))).toBe('past-extent');
    expect(reasonOn(shapeObject('rim', { x: DRAWABLE_EXTENT - 10, width: 10 }))).toBeUndefined();
    expect(
      reasonOn(
        lineObject('far-line', {
          points: [
            { x: -1e300, y: 0 },
            { x: 1e300, y: 0 },
          ],
        }),
      ),
    ).toBe('past-extent');
    // A stroke wider than the extent is refused with its object; a stroke's reach past the
    // extent is not, so an honest object at the edge keeps its outline.
    expect(reasonOn(lineObject('fat', { stroke: { color: [0, 0, 0, 1], width: 1e300 } }))).toBe(
      'past-extent',
    );
  });

  it('measures the extent on the board: a child far in its parent’s frame may sit near the origin', () => {
    const frame = frameObject('f', { x: -(2 ** 30), width: 2 ** 30 });
    const child = shapeObject('c', { parentId: 'f', x: 2 ** 30 });
    expect(reasonOn(child, frame)).toBeUndefined();
    const turned = frameObject('t', { x: 100, y: 0, rotation: Math.PI / 2 });
    // Turned a quarter, the child's x runs down the board: (100, 2^31 + 1) is past the extent.
    expect(reasonOn(shapeObject('d', { parentId: 't', x: DRAWABLE_EXTENT + 1 }), turned)).toBe(
      'past-extent',
    );
  });

  it('refuses every descendant of a refused frame or group, whatever it holds itself', () => {
    const group = groupObject('g', { y: Number.NaN });
    const frame = frameObject('f', { parentId: 'g', width: -1 });
    const child = shapeObject('c', { parentId: 'f' });
    expect(reasonOn(group)).toBe('not-finite');
    expect(reasonOn(frame, group)).toBe('undrawable-parent');
    expect(reasonOn(child, frame, group)).toBe('undrawable-parent');
    const negative = frameObject('n', { width: -1 });
    expect(reasonOn(shapeObject('k', { parentId: 'n' }), negative)).toBe('undrawable-parent');
  });

  it('refuses a group placed past the extent, which has no box of its own', () => {
    expect(reasonOn(groupObject('g', { x: 1e300 }))).toBe('past-extent');
    expect(reasonOn(groupObject('g', { x: 2 ** 30 }))).toBeUndefined();
  });

  it('draws an object whose parent is missing or in a cycle as if at the root', () => {
    expect(reasonOn(shapeObject('s', { parentId: 'gone' }))).toBeUndefined();
    const first = frameObject('a', { parentId: 'b' });
    const second = frameObject('b', { parentId: 'a' });
    expect(reasonOn(first, second)).toBeUndefined();
    expect(isDrawableIn(first, sourceOf([first, second]))).toBe(true);
  });
});
