// A board of mixed types for select same type, world units:
//
// - sticky-a, sticky-b: sticky notes at the root; sticky-locked: a locked one.
// - rect-a: a rectangle; ellipse-a, ellipse-b: ellipses (shapes of another kind).
// - frame-f holding sticky-c and frame-n, which holds sticky-d and rect-n.
// - frame-locked, locked, holding sticky-e.
// - group-g holding sticky-g, sticky-h and rect-g: selected whole, so its children are never
//   taken on their own unless the group is the scope (entered).
import type {
  BaseObject,
  BoardObject,
  GroupObject,
  PrincipalId,
  ShapeObject,
  StickyObject,
} from '@canvas/schema';

import { frame, id, rect } from './select-board.js';

/** Where a fixture object goes in its parent's frame, and whether it is locked. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly isLocked?: boolean;
}

function shared(
  objectId: string,
  parentId: string | null,
  at: Placement,
): Omit<BaseObject, 'type'> {
  return {
    id: id(objectId),
    parentId: parentId === null ? null : id(parentId),
    x: at.x,
    y: at.y,
    rotation: 0,
    z: 'a0',
    locked: at.isLocked ?? false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  };
}

/**
 * A 100 × 100 yellow sticky note with no text.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param at - Where it goes, and whether it is locked.
 * @returns The sticky note.
 */
export function sticky(objectId: string, parentId: string | null, at: Placement): StickyObject {
  return {
    ...shared(objectId, parentId, at),
    type: 'sticky',
    width: 100,
    height: 100,
    text: '',
    runs: [
      {
        length: 0,
        style: {
          fontFamily: 'Inter',
          fontSize: 16,
          color: [0, 0, 0, 1],
          weight: 400,
          italic: false,
        },
      },
    ],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  };
}

/**
 * A 60 × 40 ellipse: a shape of another kind than the fixture rectangles.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param at - Where it goes.
 * @returns The shape.
 */
export function ellipse(objectId: string, parentId: string | null, at: Placement): ShapeObject {
  return { ...rect(objectId, parentId, { ...at, width: 60, height: 40 }), kind: 'ellipse' };
}

function group(objectId: string, at: Placement): GroupObject {
  return { ...shared(objectId, null, at), type: 'group' };
}

/**
 * The mixed board's objects, parents before children.
 *
 * @returns Fresh objects.
 */
export function sameTypeBoardObjects(): BoardObject[] {
  return [
    sticky('sticky-a', null, { x: 0, y: 0 }),
    sticky('sticky-b', null, { x: 150, y: 0 }),
    sticky('sticky-locked', null, { x: 300, y: 0, isLocked: true }),
    rect('rect-a', null, { x: 0, y: 150, width: 100, height: 50 }),
    ellipse('ellipse-a', null, { x: 150, y: 150 }),
    ellipse('ellipse-b', null, { x: 250, y: 150 }),
    frame('frame-f', null, { x: 500, y: 0, width: 600, height: 400 }),
    sticky('sticky-c', 'frame-f', { x: 20, y: 20 }),
    frame('frame-n', 'frame-f', { x: 200, y: 20, width: 300, height: 300 }),
    sticky('sticky-d', 'frame-n', { x: 20, y: 20 }),
    rect('rect-n', 'frame-n', { x: 150, y: 20, width: 50, height: 50 }),
    frame('frame-locked', null, { x: 1200, y: 0, width: 300, height: 300, isLocked: true }),
    sticky('sticky-e', 'frame-locked', { x: 20, y: 20 }),
    group('group-g', { x: 0, y: 600 }),
    sticky('sticky-g', 'group-g', { x: 0, y: 0 }),
    sticky('sticky-h', 'group-g', { x: 0, y: 150 }),
    rect('rect-g', 'group-g', { x: 150, y: 0, width: 50, height: 50 }),
  ];
}
