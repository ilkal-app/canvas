import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { nestedFrameObjects } from '../commands/__fixtures__/nested-frames.js';
import type { DocumentTransaction } from '../store/document-store.js';
import { DocumentWriteError } from '../store/document-write-error.js';

import { worldOf } from './__fixtures__/cycle-fixtures.js';
import { applyParentCycleBreaks, findParentCycleBreaks } from './parent-cycles.js';

/**
 * The nested-frames board with some placements changed.
 *
 * @param changes - Per id, the fields to change.
 * @returns A lookup over the board.
 */
function boardWith(changes: Readonly<Record<string, Partial<BoardObject>>>) {
  const objects = new Map(
    nestedFrameObjects().map((object) => {
      const changed = { ...object, ...changes[object.id] } as BoardObject;
      return [changed.id, changed];
    }),
  );
  return { objects, lookup: (id: ObjectId) => objects.get(id) };
}

const ids = (...values: string[]) => values as ObjectId[];

/**
 * An object a lookup must hold.
 *
 * @param lookup - The lookup.
 * @param id - The id.
 * @returns The object.
 * @throws {Error} When the lookup has none.
 */
function must(lookup: (id: ObjectId) => BoardObject | undefined, id: string): BoardObject {
  const object = lookup(id as ObjectId);
  if (object === undefined) throw new Error(`no object "${id}"`);
  return object;
}

describe('findParentCycleBreaks', () => {
  it('finds nothing on a board without a cycle', () => {
    const { objects, lookup } = boardWith({});
    expect(findParentCycleBreaks(lookup, objects.keys())).toEqual([]);
  });

  it('re-roots the lowest id of two frames, where the cycle walked once from it draws it', () => {
    const { lookup } = boardWith({
      'frame-outer': { parentId: 'frame-side' as ObjectId },
      'frame-side': { parentId: 'frame-outer' as ObjectId, x: 30, y: 40, rotation: -0.5 },
    });
    const [only, ...rest] = findParentCycleBreaks(lookup, ids('frame-side'));
    expect(rest).toEqual([]);
    expect(only?.members).toEqual(['frame-outer', 'frame-side']);
    // Walked once from frame-outer: frame-side taken as if it were at the root.
    const expected = new Map<ObjectId, BoardObject>([
      ['frame-outer' as ObjectId, must(lookup, 'frame-outer')],
      ['frame-side' as ObjectId, { ...must(lookup, 'frame-side'), parentId: null }],
    ]);
    const rerooted = must(() => only?.rerooted, 'frame-outer');
    expect(rerooted.parentId).toBeNull();
    expect(rerooted.rotation).toBeCloseTo(-0.1, 12);
    const onBoard = new Map([[rerooted.id, rerooted]]);
    expect(worldOf({ objects: onBoard }, 'frame-outer')).toEqual(
      worldOf({ objects: expected }, 'frame-outer'),
    );
  });

  it('finds a cycle from an object below it, once however many starts reach it', () => {
    const { lookup } = boardWith({
      'frame-outer': { parentId: 'frame-side' as ObjectId },
      'frame-side': { parentId: 'frame-outer' as ObjectId },
    });
    const breaks = findParentCycleBreaks(lookup, ids('rect-inner', 'rect-side', 'frame-outer'));
    expect(breaks.map(({ rerooted }) => rerooted.id)).toEqual(['frame-outer']);
    expect(findParentCycleBreaks(lookup, ids('frame-outer', 'rect-side', 'rect-inner'))).toEqual(
      breaks,
    );
  });

  it('orders ids by UTF-16 code units, as the rest of the document does', () => {
    const { lookup } = boardWith({
      'frame-inner': { id: 'Z-inner' as ObjectId, parentId: 'frame-outer' as ObjectId },
      'frame-outer': { parentId: 'Z-inner' as ObjectId },
    });
    const [only] = findParentCycleBreaks(lookup, ids('frame-outer'));
    expect(only?.members).toEqual(['Z-inner', 'frame-outer']);
    expect(only?.rerooted.id).toBe('Z-inner');
  });

  it('breaks a placement naming its own object at the object’s own placement', () => {
    const { lookup } = boardWith({ 'frame-side': { parentId: 'frame-side' as ObjectId } });
    const [only] = findParentCycleBreaks(lookup, ids('rect-side'));
    expect(only?.members).toEqual(['frame-side']);
    expect(only?.rerooted).toEqual({
      ...lookup('frame-side' as ObjectId),
      parentId: null,
      pageId: 'page-1',
    });
  });

  it('keeps the stored local placement when the walked one is not finite', () => {
    const { lookup } = boardWith({
      'frame-outer': { parentId: 'frame-side' as ObjectId, x: 1e308 },
      'frame-side': { parentId: 'frame-outer' as ObjectId, x: 1e308 },
    });
    const [only] = findParentCycleBreaks(lookup, ids('frame-outer'));
    expect(only?.rerooted).toMatchObject({ parentId: null, x: 1e308, y: 50, rotation: 0.4 });
  });

  it('breaks each of several cycles, sorted by the re-rooted id', () => {
    const { lookup } = boardWith({
      'frame-side': { parentId: 'rect-side' as ObjectId },
      'rect-side': { parentId: 'frame-side' as ObjectId },
      'frame-outer': { parentId: 'frame-inner' as ObjectId },
    });
    const breaks = findParentCycleBreaks(lookup, ids('rect-side', 'rect-inner'));
    expect(breaks.map(({ rerooted }) => rerooted.id)).toEqual(['frame-inner', 'frame-side']);
  });

  it('uses the stored local placement when only accumulated rotation overflows', () => {
    const { lookup } = boardWith({
      'frame-outer': { parentId: 'frame-side' as ObjectId, rotation: 1e308 },
      'frame-side': { parentId: 'frame-outer' as ObjectId, rotation: 1e308 },
    });
    const [only] = findParentCycleBreaks(lookup, ids('frame-outer'));
    expect(only?.rerooted).toEqual({
      ...lookup('frame-outer' as ObjectId),
      parentId: null,
      pageId: 'page-1',
    });
  });
});

describe('applyParentCycleBreaks', () => {
  const { lookup } = boardWith({ 'frame-side': { parentId: 'frame-side' as ObjectId } });
  const breaks = findParentCycleBreaks(lookup, ids('frame-side'));
  const refusing = (error: unknown) =>
    ({
      setObject: () => {
        throw error;
      },
    }) as unknown as DocumentTransaction;

  it('skips a break the store refuses, and rethrows any other error', () => {
    expect(
      applyParentCycleBreaks(refusing(new DocumentWriteError('frame-side', [])), breaks),
    ).toEqual([]);
    const failure = new Error('the write failed');
    expect(() => applyParentCycleBreaks(refusing(failure), breaks)).toThrow(failure);
  });
});
