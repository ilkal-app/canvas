// Nightly 40308498491 (seed 46): `placeObjects` took a text into a turned frame inside
// the group that already held it. The group sat at y = 1e308, a stored value past the bound
// (raw writes the relay's door lets through, or a board stored before the door). The text's new
// place went through board coordinates, where 1e308 swallows every other term and the frame's
// turn left 8.4e307 in x, so a later fit of the frame was refused for its width. Where an object
// sits relative to its new parent does not depend on the ancestors both share: their places and
// turns must never enter the sum.
import { describe, expect, it } from 'vitest';

import type { Board, BoardObject, ObjectId } from '@canvas/schema';

import { placementIn } from './reparent.js';

/**
 * A plain object with a place, turn and parent.
 *
 * @param id - Its id.
 * @param type - Its type.
 * @param parentId - Its parent.
 * @param place - Its x, y and rotation.
 * @param place.x - Its x.
 * @param place.y - Its y.
 * @param place.rotation - Its rotation, radians.
 * @returns The object.
 */
function placed(
  id: string,
  type: string,
  parentId: string | null,
  place: { readonly x: number; readonly y: number; readonly rotation: number },
): BoardObject {
  return { id, type, parentId, ...place } as unknown as BoardObject;
}

/**
 * A group at `groupPlace` holding a frame turned by -1 at (100, 50) and a text at (30, 70).
 *
 * @param groupPlace - The group's place.
 * @param groupPlace.x - Its x.
 * @param groupPlace.y - Its y.
 * @param groupPlace.rotation - Its rotation.
 * @returns The board.
 */
function boardWithGroupAt(groupPlace: { x: number; y: number; rotation: number }): Board {
  const objects = [
    placed('g', 'group', null, groupPlace),
    placed('f', 'frame', 'g', { x: 100, y: 50, rotation: -1 }),
    placed('t', 'text', 'g', { x: 30, y: 70, rotation: 0.5 }),
    placed('inner', 'frame', 'f', { x: 10, y: 0, rotation: 0.25 }),
  ];
  return { objects: new Map(objects.map((object) => [object.id, object])) };
}

/**
 * An object of a board, which the test put there.
 *
 * @param board - The board.
 * @param id - Its id.
 * @returns The object.
 * @throws {Error} When the board has no such object.
 */
function objectOf(board: Board, id: string): BoardObject {
  const object = board.objects.get(id as ObjectId);
  if (object === undefined) throw new Error(`no object ${id}`);
  return object;
}

/** Where the text lands in the frame when the group sits at the origin, unturned. */
const NEAR = placementIn(
  boardWithGroupAt({ x: 0, y: 0, rotation: 0 }),
  objectOf(boardWithGroupAt({ x: 0, y: 0, rotation: 0 }), 't'),
  'f' as ObjectId,
);

describe('placementIn across a shared ancestor', () => {
  it.each([
    { x: 0, y: 1e308, rotation: 0 },
    { x: -1592, y: 1e308, rotation: 0 },
    { x: 2 ** 40, y: -(2 ** 40), rotation: 2 },
  ])('gives the same place whatever the shared group holds: %o', (groupPlace) => {
    const board = boardWithGroupAt(groupPlace);
    const text = objectOf(board, 't');
    const place = placementIn(board, text, 'f' as ObjectId);
    expect(place?.x).toBeCloseTo(NEAR?.x ?? Number.NaN, 9);
    expect(place?.y).toBeCloseTo(NEAR?.y ?? Number.NaN, 9);
    expect(place?.rotation).toBeCloseTo(NEAR?.rotation ?? Number.NaN, 12);
  });

  it('still maps through every parent that differs, down a nested chain and back up', () => {
    const board = boardWithGroupAt({ x: 0, y: 1e308, rotation: 0 });
    const text = objectOf(board, 't');
    const inner = placementIn(board, text, 'inner' as ObjectId);
    const near = boardWithGroupAt({ x: 0, y: 0, rotation: 0 });
    const nearInner = placementIn(near, objectOf(near, 't'), 'inner' as ObjectId);
    expect(inner?.x).toBeCloseTo(nearInner?.x ?? Number.NaN, 9);
    expect(inner?.y).toBeCloseTo(nearInner?.y ?? Number.NaN, 9);
    // Back out of both frames into the group gives the text's own place again.
    const out = placementIn(
      board,
      { ...text, ...inner, parentId: 'inner' } as BoardObject,
      'g' as ObjectId,
    );
    expect(out?.x).toBeCloseTo(30, 9);
    expect(out?.y).toBeCloseTo(70, 9);
  });

  it('still refuses a chain of parents that forms a cycle', () => {
    const objects = [
      placed('a', 'frame', 'b', { x: 0, y: 0, rotation: 0 }),
      placed('b', 'frame', 'a', { x: 0, y: 0, rotation: 0 }),
      placed('t', 'text', null, { x: 1, y: 1, rotation: 0 }),
    ];
    const board = {
      objects: new Map(objects.map((object) => [object.id, object])),
    } as unknown as Board;
    expect(placementIn(board, objectOf(board, 't'), 'a' as ObjectId)).toBeNull();
  });
});
