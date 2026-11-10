// A small board for the select tool's tests, with exact geometry (world units):
//
// - rect-a: 100 × 50 at (0, 0).
// - rect-b: 100 × 50 at (200, 0), turned a quarter turn clockwise, so it covers x 150–200, y 0–100.
// - frame-f: 300 × 200 at (400, 0), holding rect-c: 50 × 50 at (20, 20), so (420, 20) on the board;
//   its title band (24 px at 100%) is y −24 to 0 over x 400–700.
// - group-g at (0, 300) holding rect-d: 40 × 40 at (0, 0), and group-h at (60, 0) holding rect-e:
//   40 × 40 at (0, 0), so rect-e is at (60, 300).
// - line-l at (0, 500) from (0, 0) to (100, 50), stroke 2.
// - rect-locked: 50 × 50 at (800, 0), locked.
// - connector-k from rect-a to rect-c, read placed as the app's hit index reads it: from rect-a's
//   right side (100, 25) to rect-c's left side (420, 45).
// - path-empty, a path with no vertices: no geometry.
import { ConnectorPlacements, SceneSpatialIndex } from '@canvas/engine';
import type {
  BoardObject,
  ConnectorObject,
  FrameObject,
  GroupObject,
  LineObject,
  ObjectId,
  PathObject,
  PrincipalId,
  ShapeObject,
} from '@canvas/schema';

import type { SelectionSource } from '../selection-geometry.js';

/**
 * Reads a fixture id as an object id.
 *
 * @param value - The id text.
 * @returns The id, branded.
 */
export function id(value: string): ObjectId {
  return value as ObjectId;
}

function shared(objectId: string, parentId: string | null, x: number, y: number) {
  return {
    id: id(objectId),
    parentId: parentId === null ? null : id(parentId),
    x,
    y,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_770_000_000_000,
    updatedAt: 1_770_000_000_000,
  };
}

/** Where a fixture rectangle goes, in its parent's frame. */
export interface RectPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly isLocked?: boolean;
}

/**
 * A filled rectangle shape.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param box - Position and size in the parent's frame, and optional rotation and lock.
 * @returns The shape.
 */
export function rect(objectId: string, parentId: string | null, box: RectPlacement): ShapeObject {
  return {
    ...shared(objectId, parentId, box.x, box.y),
    rotation: box.rotation ?? 0,
    locked: box.isLocked ?? false,
    type: 'shape',
    kind: 'rectangle',
    width: box.width,
    height: box.height,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A frame with a white background and no clipping, named after its id.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param box - Position and size in the parent's frame, and optional rotation and lock.
 * @returns The frame.
 */
export function frame(objectId: string, parentId: string | null, box: RectPlacement): FrameObject {
  return {
    ...shared(objectId, parentId, box.x, box.y),
    rotation: box.rotation ?? 0,
    locked: box.isLocked ?? false,
    type: 'frame',
    width: box.width,
    height: box.height,
    name: objectId,
    clip: false,
    background: [1, 1, 1, 1],
  };
}

/**
 * A group.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param x - Its x in the parent's frame.
 * @param y - Its y in the parent's frame.
 * @param rotation - Its rotation, radians.
 * @returns The group.
 */
export function group(
  objectId: string,
  parentId: string | null,
  x: number,
  y: number,
  rotation = 0,
): GroupObject {
  return { ...shared(objectId, parentId, x, y), rotation, type: 'group' };
}

const LINE: LineObject = {
  ...shared('line-l', null, 0, 500),
  type: 'line',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
  route: 'straight',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'none',
};

/**
 * A straight connector with an arrow at its end, unturned at the origin of the root, no label.
 *
 * @param objectId - Its id.
 * @param ends - Its two ends, and any fields to override.
 * @returns The connector.
 */
export function connector(
  objectId: string,
  ends: Pick<ConnectorObject, 'from' | 'to'> & Partial<ConnectorObject>,
): ConnectorObject {
  return {
    ...shared(objectId, null, 0, 0),
    type: 'connector',
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: null,
    ...ends,
  };
}

const CONNECTOR: ConnectorObject = {
  ...shared('connector-k', null, 0, 0),
  type: 'connector',
  from: { kind: 'object', objectId: id('rect-a'), anchor: null },
  to: { kind: 'object', objectId: id('rect-c'), anchor: null },
  route: 'straight',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  label: null,
};

const EMPTY_PATH: PathObject = {
  ...shared('path-empty', null, 0, 0),
  type: 'path',
  vertices: [],
  segments: [],
  stroke: null,
  fill: null,
};

/**
 * The fixture board's objects, parents before children.
 *
 * @returns Fresh objects.
 */
export function selectBoardObjects(): BoardObject[] {
  return [
    rect('rect-a', null, { x: 0, y: 0, width: 100, height: 50 }),
    rect('rect-b', null, { x: 200, y: 0, width: 100, height: 50, rotation: Math.PI / 2 }),
    frame('frame-f', null, { x: 400, y: 0, width: 300, height: 200 }),
    rect('rect-c', 'frame-f', { x: 20, y: 20, width: 50, height: 50 }),
    group('group-g', null, 0, 300),
    rect('rect-d', 'group-g', { x: 0, y: 0, width: 40, height: 40 }),
    group('group-h', 'group-g', 60, 0),
    rect('rect-e', 'group-h', { x: 0, y: 0, width: 40, height: 40 }),
    LINE,
    rect('rect-locked', null, { x: 800, y: 0, width: 50, height: 50, isLocked: true }),
    CONNECTOR,
    EMPTY_PATH,
  ];
}

/**
 * A selection source over a list of objects, with a child index.
 *
 * @param objects - The objects.
 * @returns The source.
 */
export function mapSource(objects: readonly BoardObject[]): SelectionSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const children = new Map<ObjectId, ObjectId[]>();
  for (const object of objects) {
    if (object.parentId === null) continue;
    children.set(object.parentId, [...(children.get(object.parentId) ?? []), object.id]);
  }
  const childrenOf = (objectId: ObjectId): readonly ObjectId[] => children.get(objectId) ?? [];
  // Connectors placed on their targets, as the app's hit index reads them.
  const placements = new ConnectorPlacements();
  const targets = { get: (objectId: ObjectId) => byId.get(objectId), childrenOf };
  return {
    get: (objectId) => {
      const object = byId.get(objectId);
      return object?.type === 'connector' ? placements.place(object, targets) : object;
    },
    childrenOf,
  };
}

/**
 * A spatial index over objects, as the app keeps one for hit testing.
 *
 * @param objects - The objects.
 * @returns The index.
 */
export function indexOf(objects: readonly BoardObject[]): SceneSpatialIndex {
  const index = new SceneSpatialIndex();
  const source = mapSource(objects);
  const created = objects.map((object) => object.id);
  index.apply({ created, updated: [], deleted: [], get: (key) => source.get(key) });
  return index;
}
