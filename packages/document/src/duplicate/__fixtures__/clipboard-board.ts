// A small board for the clipboard's tests: a frame turned a quarter turn holding a group of two
// shapes, a shape outside it with a connector from the group to it, a styled text, an image,
// and a comment pinned to the outside shape.
import {
  createBoard,
  type AssetId,
  type Board,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
  type TextStyle,
} from '@canvas/schema';

/** The regular style of the fixture's text. */
export const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/** The bold style of the fixture's text. */
export const BOLD: TextStyle = { ...BODY, weight: 700 };

/**
 * The fields every fixture object shares.
 *
 * @param id - The id.
 * @param z - The stacking key.
 * @param parentId - The parent, or null for the root.
 * @returns The shared fields.
 */
function shared(id: string, z: string, parentId: string | null = null) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  };
}

/**
 * A rectangle.
 *
 * @param id - The id.
 * @param z - The stacking key.
 * @param parentId - The parent, or null.
 * @param x - Its x in the parent's frame.
 * @returns The shape.
 */
function rectangle(id: string, z: string, parentId: string | null, x: number): BoardObject {
  return {
    ...shared(id, z, parentId),
    type: 'shape',
    x,
    y: 0,
    width: 40,
    height: 20,
    kind: 'rectangle',
    stroke: null,
    fill: [0.2, 0.4, 0.8, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * The fixture board.
 *
 * @returns A new board.
 */
export function clipboardBoard(): Board {
  const objects: BoardObject[] = [
    {
      ...shared('frame', 'a0'),
      type: 'frame',
      x: 1000,
      y: 0,
      rotation: Math.PI / 2,
      width: 400,
      height: 300,
      name: 'Frame',
      clip: false,
      background: null,
    },
    { ...shared('group', 'a0', 'frame'), type: 'group', x: 100, y: 50 },
    rectangle('left', 'a0', 'group', 0),
    rectangle('right', 'a1', 'group', 60),
    rectangle('outside', 'a1', null, 0),
    {
      ...shared('link', 'a2'),
      type: 'connector',
      x: 0,
      y: 0,
      from: { kind: 'object', objectId: 'left' as ObjectId, anchor: null },
      to: { kind: 'object', objectId: 'outside' as ObjectId, anchor: { x: 1, y: 0.5 } },
      route: 'straight',
      stroke: { color: [0, 0, 0, 1], width: 2 },
      startCap: 'none',
      endCap: 'arrow',
      label: null,
    },
    {
      ...shared('title', 'a3'),
      type: 'text',
      x: 0,
      y: 200,
      width: 200,
      height: 24,
      text: 'Bold 👋 plain',
      runs: [
        { length: 5, style: BOLD },
        { length: 8, style: BODY },
      ],
      align: 'left',
      autoWidth: true,
      verticalAlign: 'top',
    },
    {
      ...shared('photo', 'a4'),
      type: 'image',
      x: 300,
      y: 200,
      width: 160,
      height: 90,
      assetId: 'asset-photo' as AssetId,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      naturalSize: { width: 1600, height: 900 },
      opacity: 1,
    },
    {
      ...shared('pin', 'a5'),
      type: 'comment',
      x: 0,
      y: 0,
      threadId: 'thread-1',
      anchor: { kind: 'object', objectId: 'outside' as ObjectId, offset: { x: 5, y: 5 } },
    },
  ];
  return createBoard(objects);
}

/**
 * Reads an object of a board that must be there.
 *
 * @param board - The board.
 * @param id - The id.
 * @returns The object.
 * @throws {Error} When there is none.
 */
export function objectOf(board: Board, id: string): BoardObject {
  const object = board.objects.get(id as ObjectId);
  if (object === undefined) throw new Error(`no object "${id}"`);
  return object;
}
