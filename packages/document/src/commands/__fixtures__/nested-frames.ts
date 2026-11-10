// A board of turned and nested frames for the reparenting move, world units:
//
// - frame-outer: 400 × 300 at (100, 50) on the root, turned 0.4 rad; it holds
//   - frame-inner: 200 × 150 at (30, 20), turned −0.25 rad, holding rect-inner (z a0) and
//     rect-inner-2 (z a1);
//   - rect-outer: 40 × 30 at (250, 200), turned 0.1 rad;
//   - group-g at (300, 30), holding rect-grouped at (0, 0).
// - frame-side: 300 × 300 at (800, 0) on the root, unturned, holding rect-side (z a5).
// - rect-free: 40 × 30 at (600, 400) on the root; rect-locked: 40 × 30 at (0, 600), locked.
import type {
  BoardObject,
  FrameObject,
  GroupObject,
  ObjectId,
  PrincipalId,
  ShapeObject,
} from '@canvas/schema';

import { ADA } from '../../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';

/** Where a fixture object sits in its parent's frame. */
interface Placement {
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  readonly z?: string;
  readonly isLocked?: boolean;
}

function shared(id: string, parentId: string | null, placement: Placement) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation ?? 0,
    z: placement.z ?? 'a0',
    locked: placement.isLocked ?? false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  };
}

function frame(
  id: string,
  parentId: string | null,
  placement: Placement,
  size: readonly [number, number],
): FrameObject {
  return {
    ...shared(id, parentId, placement),
    type: 'frame',
    width: size[0],
    height: size[1],
    name: id,
    clip: false,
    background: [1, 1, 1, 1],
  };
}

function rect(id: string, parentId: string | null, placement: Placement): ShapeObject {
  return {
    ...shared(id, parentId, placement),
    type: 'shape',
    kind: 'rectangle',
    width: 40,
    height: 30,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

function group(id: string, parentId: string | null, placement: Placement): GroupObject {
  return { ...shared(id, parentId, placement), type: 'group' };
}

/**
 * The nested-frames board's objects.
 *
 * @returns The objects, parents before children.
 */
export function nestedFrameObjects(): BoardObject[] {
  return [
    frame('frame-outer', null, { x: 100, y: 50, rotation: 0.4 }, [400, 300]),
    frame('frame-inner', 'frame-outer', { x: 30, y: 20, rotation: -0.25, z: 'a1' }, [200, 150]),
    rect('rect-inner', 'frame-inner', { x: 20, y: 30 }),
    rect('rect-inner-2', 'frame-inner', { x: 100, y: 60, z: 'a1' }),
    rect('rect-outer', 'frame-outer', { x: 250, y: 200, rotation: 0.1, z: 'a2' }),
    group('group-g', 'frame-outer', { x: 300, y: 30, z: 'a3' }),
    rect('rect-grouped', 'group-g', { x: 0, y: 0 }),
    frame('frame-side', null, { x: 800, y: 0, z: 'a1' }, [300, 300]),
    rect('rect-side', 'frame-side', { x: 10, y: 10, z: 'a5' }),
    rect('rect-free', null, { x: 600, y: 400, z: 'a2' }),
    rect('rect-locked', null, { x: 0, y: 600, z: 'a3', isLocked: true }),
  ];
}

/**
 * A store holding the nested-frames board, written by Ada in one transaction.
 *
 * @returns The store.
 */
export function createNestedFramesStore(): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of nestedFrameObjects()) transaction.setObject(object);
  });
  return store;
}
