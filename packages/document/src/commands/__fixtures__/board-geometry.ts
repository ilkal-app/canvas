import {
  applyTransform,
  parentToBoardTransform,
  type Board,
  type ObjectId,
  type Point,
} from '@canvas/schema';

/**
 * Where an object's local origin and its x axis point, on the board: enough to tell that an
 * object has not moved on screen after a reparent (there is no scale).
 *
 * @param board - The board.
 * @param objectId - The object id.
 * @returns The board positions of the object's (0, 0) and (1, 0).
 * @throws {Error} When the board has no such object.
 */
export function boardPlacement(board: Board, objectId: string): readonly [Point, Point] {
  const object = board.objects.get(objectId as ObjectId);
  if (object === undefined) throw new Error(`no object "${objectId}"`);
  const toBoard = parentToBoardTransform(board, object);
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  return [
    applyTransform(toBoard, { x: object.x, y: object.y }),
    applyTransform(toBoard, { x: object.x + cos, y: object.y + sin }),
  ];
}

/**
 * Expects two placements to be the same up to floating-point noise.
 *
 * @param actual - The placement after.
 * @param expected - The placement before.
 * @param expectClose - The test's `toBeCloseTo` check.
 */
export function expectSamePlacement(
  actual: readonly [Point, Point],
  expected: readonly [Point, Point],
  expectClose: (actual: number, expected: number) => void,
): void {
  actual.forEach((point, index) => {
    expectClose(point.x, expected[index]?.x ?? Number.NaN);
    expectClose(point.y, expected[index]?.y ?? Number.NaN);
  });
}

/**
 * A placement shifted by a displacement on the board, as a move leaves it.
 *
 * @param placement - The board positions of an object's (0, 0) and (1, 0).
 * @param by - The displacement, world units.
 * @returns The shifted placement.
 */
export function shiftedPlacement(
  placement: readonly [Point, Point],
  by: Point,
): readonly [Point, Point] {
  return [
    { x: placement[0].x + by.x, y: placement[0].y + by.y },
    { x: placement[1].x + by.x, y: placement[1].y + by.y },
  ];
}
