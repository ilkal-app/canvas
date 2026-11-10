import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  objectToBoardTransform,
  type LineObject,
  type Point,
} from '@canvas/schema';

import {
  BOB,
  createFixtureStore,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { setLinePointsCommand } from './set-line-points.js';
import { setLockedCommand } from './set-locked.js';

/**
 * A line of a store.
 *
 * @param store - The store.
 * @param id - The line's id.
 * @returns The line.
 * @throws {Error} When the object is not a line.
 */
function lineOf(store: ReturnType<typeof createGroupedStore>, id: string): LineObject {
  const object = mustGet(store, id);
  if (object.type !== 'line') throw new Error(`"${id}" is not a line`);
  return object;
}

/**
 * A line's two ends in board coordinates.
 *
 * @param store - The store.
 * @param id - The line's id.
 * @returns Its start and end.
 */
function endsOf(store: ReturnType<typeof createGroupedStore>, id: string): Point[] {
  const line = lineOf(store, id);
  const toBoard = objectToBoardTransform(store.read(), line);
  return line.points.map((point) => applyTransform(toBoard, point));
}

describe('setLinePoints', () => {
  it('writes only the moved end and the stamp, converted from board coordinates', () => {
    const store = createGroupedStore();
    const before = store.read();
    const line = lineOf(store, 'line-l');
    const [start] = endsOf(store, 'line-l');
    const { result, changes } = applyCommand(store, setLinePointsCommand, {
      id: 'line-l',
      end: 1,
      point: { x: 500, y: 420 },
    });
    expect(result).toEqual({ changedIds: ['line-l'] });
    expectDiff(before, store.read(), changes, { updated: ['line-l'] });
    const after = lineOf(store, 'line-l');
    expect({ ...after, points: line.points }).toEqual({ ...line, updatedAt: NOW });
    expect(after.points[0]).toEqual(line.points[0]);
    // The moved end sits where the command put it on the board, inside two rotated groups;
    // the other end has not moved.
    const [newStart, newEnd] = endsOf(store, 'line-l');
    expect(newStart).toEqual(start);
    expect(newEnd?.x).toBeCloseTo(500, 9);
    expect(newEnd?.y).toBeCloseTo(420, 9);
  });

  it('moves the start the same way', () => {
    const store = createGroupedStore();
    const line = lineOf(store, 'line-m');
    applyCommand(store, setLinePointsCommand, { id: 'line-m', end: 0, point: { x: 0, y: 0 } });
    const [start] = endsOf(store, 'line-m');
    expect(start?.x).toBeCloseTo(0, 9);
    expect(start?.y).toBeCloseTo(0, 9);
    expect(lineOf(store, 'line-m').points[1]).toEqual(line.points[1]);
  });

  it('writes nothing, and no stamp, when the end is already there', () => {
    const store = createGroupedStore();
    applyCommand(store, setLinePointsCommand, { id: 'line-l', end: 0, point: { x: 7, y: 9 } });
    const again = store.encodeState();
    const second = applyCommand(store, setLinePointsCommand, {
      id: 'line-l',
      end: 0,
      point: { x: 7, y: 9 },
    });
    expect(second.result.changedIds).toEqual([]);
    expect(store.encodeState()).toEqual(again);
  });

  it('refuses to put an end on the other end, writing nothing', () => {
    const store = createGroupedStore();
    const before = store.encodeState();
    const [start] = endsOf(store, 'line-l');
    if (start === undefined) throw new Error('no start');
    const errors = expectRejected(store, setLinePointsCommand, {
      id: 'line-l',
      end: 1,
      point: start,
    });
    expect(errors.map(({ code, objectId, path }) => ({ code, objectId, path }))).toEqual([
      { code: 'invalid-input', objectId: 'line-l', path: ['point'] },
    ]);
    expect(errors[0]?.message).toContain('would meet');
    expect(store.encodeState()).toEqual(before);
  });

  it('refuses a locked line, writing nothing', () => {
    const store = createGroupedStore();
    applyCommand(store, setLockedCommand, { ids: ['line-l'], locked: true });
    const errors = expectRejected(store, setLinePointsCommand, {
      id: 'line-l',
      end: 1,
      point: { x: 10, y: 10 },
    });
    expect(errors.map(({ code, objectId, path }) => ({ code, objectId, path }))).toEqual([
      { code: 'locked', objectId: 'line-l', path: ['id'] },
    ]);
  });

  it('refuses anything but a line, and an unknown id', () => {
    const store = createFixtureStore();
    const move = { end: 1, point: { x: 10, y: 10 } } as const;
    expect(
      expectRejected(store, setLinePointsCommand, { id: 'shape-box', ...move }).map(
        ({ code }) => code,
      ),
    ).toEqual(['unsupported-type']);
    expect(
      expectRejected(store, setLinePointsCommand, { id: 'nowhere', ...move }).map(
        ({ code }) => code,
      ),
    ).toEqual(['missing-object']);
  });

  it('refuses an end whose place in the line’s frame overflows: it would lie past the board bound', () => {
    const store = createGroupedStore();
    // Brought into the line's turned frame, the coordinates overflow; only what is not finite is
    // clamped, and the line would reach past the bound.
    const huge = 1.7e308;
    const errors = expectRejected(store, setLinePointsCommand, {
      id: 'line-l',
      end: 1,
      point: { x: huge, y: huge },
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['invalid-input', 'line-l', []],
    ]);
  });

  it('refuses a line that hangs below a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(BOB, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.patchObject(id('line-divider'), { parentId: id('loop-a') });
    });
    const errors = refusalsOn(storedBoardOf(store), setLinePointsCommand, {
      id: 'line-divider',
      end: 1,
      point: { x: 10, y: 10 },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'parent-cycle', objectId: 'line-divider' }),
    ]);
  });

  it('refuses malformed input: a third end, both points, or a point that is not a number', () => {
    const store = createGroupedStore();
    const inputs = [
      { id: 'line-l', end: 2, point: { x: 0, y: 0 } },
      {
        id: 'line-l',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      { id: 'line-l', end: 0, point: { x: Number.NaN, y: 0 } },
    ];
    for (const input of inputs) {
      const errors = expectRejected(store, setLinePointsCommand, input);
      expect(errors.map(({ code }) => code)).toContain('invalid-input');
    }
  });
});
