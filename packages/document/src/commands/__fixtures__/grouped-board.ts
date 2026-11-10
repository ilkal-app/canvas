// A board of nested, turned groups for the group resize, world units:
//
// - group-outer at (100, 50) on the root, turned 0.4 rad; it holds
//   - rect-a: 100 × 50 at (0, 0);
//   - rect-b: 50 × 40 at (150, 100);
//   - line-l at (20, 200): from (0, 0) to (100, 40);
//   - path-p at (200, 180): three vertices, curved handles;
//   - group-inner at (60, 120), turned 0.3 rad, holding rect-c: 40 × 30 at (10, 10), and
//     line-m at (0, 60): from (0, 0) to (50, 0).
// - rect-free: 40 × 30 at (600, 400) on the root.
// The outer group's derived box, in its own frame, starts at (0, 0).
import type {
  BoardObject,
  GroupObject,
  LineObject,
  ObjectId,
  PathObject,
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
}

function shared(id: string, parentId: string | null, placement: Placement) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    x: placement.x,
    y: placement.y,
    rotation: placement.rotation ?? 0,
    z: placement.z ?? 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  };
}

function rect(
  id: string,
  parentId: string | null,
  placement: Placement,
  size: readonly [number, number],
): ShapeObject {
  return {
    ...shared(id, parentId, placement),
    type: 'shape',
    kind: 'rectangle',
    width: size[0],
    height: size[1],
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

function line(
  id: string,
  parentId: string,
  placement: Placement,
  end: { readonly x: number; readonly y: number },
): LineObject {
  return {
    ...shared(id, parentId, placement),
    type: 'line',
    points: [{ x: 0, y: 0 }, end],
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
  };
}

function path(id: string, parentId: string, placement: Placement): PathObject {
  return {
    ...shared(id, parentId, placement),
    type: 'path',
    vertices: [
      { id: 'v1', x: 0, y: 0, mirror: 'none' },
      { id: 'v2', x: 60, y: 10, mirror: 'both' },
      { id: 'v3', x: 90, y: 50, mirror: 'angle' },
    ],
    segments: [
      { id: 's1', a: 'v1', b: 'v2', ha: { x: 10, y: -20 }, hb: { x: -15, y: -5 } },
      { id: 's2', a: 'v2', b: 'v3', ha: { x: 15, y: 5 }, hb: { x: 0, y: -10 } },
    ],
    stroke: { color: [0, 0, 1, 1], width: 3 },
    fill: null,
  };
}

function group(id: string, parentId: string | null, placement: Placement): GroupObject {
  return { ...shared(id, parentId, placement), type: 'group' };
}

/**
 * The grouped board's objects.
 *
 * @returns The objects, parents before children.
 */
export function groupedBoardObjects(): BoardObject[] {
  return [
    group('group-outer', null, { x: 100, y: 50, rotation: 0.4 }),
    rect('rect-a', 'group-outer', { x: 0, y: 0 }, [100, 50]),
    rect('rect-b', 'group-outer', { x: 150, y: 100, z: 'a1' }, [50, 40]),
    line('line-l', 'group-outer', { x: 20, y: 200, z: 'a2' }, { x: 100, y: 40 }),
    path('path-p', 'group-outer', { x: 200, y: 180, z: 'a3' }),
    group('group-inner', 'group-outer', { x: 60, y: 120, rotation: 0.3, z: 'a4' }),
    rect('rect-c', 'group-inner', { x: 10, y: 10 }, [40, 30]),
    line('line-m', 'group-inner', { x: 0, y: 60, z: 'a1' }, { x: 50, y: 0 }),
    rect('rect-free', null, { x: 600, y: 400, z: 'a1' }, [40, 30]),
  ];
}

/**
 * A store holding the grouped board, written by Ada in one transaction.
 *
 * @param clientId - The Yjs client id to fix, so which of two concurrent writes wins is known;
 *   random when absent.
 * @returns The store.
 */
export function createGroupedStore(clientId?: number): YjsDocumentStore {
  const store = new YjsDocumentStore(clientId === undefined ? {} : { clientId });
  store.transact(ADA, (transaction) => {
    for (const object of groupedBoardObjects()) transaction.setObject(object);
  });
  return store;
}
