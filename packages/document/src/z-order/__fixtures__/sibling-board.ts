import {
  isValidKey,
  type FrameObject,
  type ObjectId,
  type PrincipalId,
  type ShapeObject,
} from '@canvas/schema';

import { SYSTEM_ORIGIN } from '../../origin/transaction-origin.js';
import { writeKeysRemotely } from '../../store/__fixtures__/remote-keys.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { generateNKeysBetween } from '../fractional-key.js';

// Boards for the z-order tests: a frame whose children are plain shapes with known keys, and a
// few shapes at the board root.

/** The id of the frame every `s<n>` shape belongs to. */
export const FRAME_ID = 'frame' as ObjectId;

/**
 * Reads a test id as an object id.
 *
 * @param value - The id text.
 * @returns The id, branded.
 */
export function objectId(value: string): ObjectId {
  return value as ObjectId;
}

/**
 * Builds a plain rectangle.
 *
 * @param id - Its id.
 * @param parentId - Its parent, or null for the root.
 * @param z - Its key.
 * @returns The shape.
 */
export function rectangle(id: string, parentId: ObjectId | null, z: string): ShapeObject {
  return {
    id: objectId(id),
    type: 'shape',
    parentId,
    x: 0,
    y: 0,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'system' as PrincipalId,
    createdAt: 0,
    updatedAt: 0,
    width: 100,
    height: 100,
    kind: 'rectangle',
    stroke: null,
    fill: [0.5, 0.5, 0.5, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * Builds the frame the `s<n>` shapes belong to.
 *
 * @returns The frame, at the root with key `a0`.
 */
function frame(): FrameObject {
  return {
    id: FRAME_ID,
    type: 'frame',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'system' as PrincipalId,
    createdAt: 0,
    updatedAt: 0,
    width: 1000,
    height: 1000,
    name: 'Siblings',
    clip: false,
    background: null,
  };
}

/**
 * Creates a store holding the frame, `count` shapes `s0`…`s<count-1>` inside it (keys `a0`,
 * `a1`, … bottom to top) and the root shapes `r0` and `r1` (keys `a1`, `a2`, above the frame).
 * A replacement key the schema rejects is written by a remote peer, since the store refuses it
 * locally.
 *
 * @param count - How many shapes in the frame.
 * @param keys - Keys to use instead of the generated ones, by index.
 * @param clientId - The Yjs client id it writes with, fixed so that runs replay exactly.
 * @returns The store.
 */
export function createSiblingStore(
  count = 6,
  keys: Readonly<Record<number, string>> = {},
  clientId = 1,
): YjsDocumentStore {
  const generated = generateNKeysBetween(null, null, count);
  const store = new YjsDocumentStore({ clientId });
  const invalid: Record<string, string> = {};
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(frame());
    transaction.setObject(rectangle('r0', null, 'a1'));
    transaction.setObject(rectangle('r1', null, 'a2'));
    generated.forEach((key, index) => {
      const id = `s${String(index)}`;
      const replacement = keys[index];
      if (replacement !== undefined && !isValidKey(replacement)) invalid[id] = replacement;
      const isUsable = replacement !== undefined && isValidKey(replacement);
      transaction.setObject(rectangle(id, FRAME_ID, isUsable ? replacement : key));
    });
  });
  writeKeysRemotely(store, invalid);
  return store;
}
