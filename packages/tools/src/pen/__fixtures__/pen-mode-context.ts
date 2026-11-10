// A pen mode's context over a real document store, for the pen and vector-edit tests: ids are
// numbered, previews, selections, notices and exit requests are recorded, and every change set
// is kept, so a test can count one command per gesture. At zoom 1 with the camera at the origin,
// screen and world points are equal.
import { YjsDocumentStore, type ChangeSet, type TransactionOrigin } from '@canvas/document';
import type { BoardObject, BoardObjectOf, ObjectId, Point, PrincipalId } from '@canvas/schema';

import type { ToolMode, ToolPointerInput } from '../../modes/tool-mode.js';
import type { PenModeContext } from '../pen-context.js';

/** Who draws. */
export const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/** The pen style the context gives new paths: the prototype's default stroke, no fill. */
export const PEN_STYLE = { stroke: { color: [0.1, 0.1, 0.1, 1], width: 2 }, fill: null } as const;

/** What the context recorded. */
export interface PenModeRecord {
  /** The preview shown per object. */
  readonly previews: Map<ObjectId, BoardObject | undefined>;
  /** Selections asked for. */
  readonly selected: (readonly ObjectId[])[];
  /** Notices given. */
  readonly notices: string[];
  /** Every change set the store delivered. */
  readonly changes: ChangeSet[];
  /** How many times the mode asked to end. */
  exitRequests: number;
}

/**
 * A context over a store holding some objects.
 *
 * @param objects - What the store starts with.
 * @returns The store, the context and what it records.
 */
export function createPenModeContext(objects: readonly BoardObject[] = []): {
  readonly store: YjsDocumentStore;
  readonly context: PenModeContext;
  readonly record: PenModeRecord;
} {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  const record: PenModeRecord = {
    previews: new Map(),
    selected: [],
    notices: [],
    changes: [],
    exitRequests: 0,
  };
  store.subscribe((changes) => record.changes.push(changes));
  let nextId = 1;
  const context: PenModeContext = {
    store,
    origin: ADA,
    environment: {
      clock: () => 1_770_000_000_000,
      createId: () => `id${String(nextId++)}` as ObjectId,
    },
    newPathStyle: () => ({
      stroke: { ...PEN_STYLE.stroke, color: [0.1, 0.1, 0.1, 1] },
      fill: null,
    }),
    setPreview: (id, object) => record.previews.set(id, object),
    selectObjects: (ids) => record.selected.push(ids),
    requestExit: () => (record.exitRequests += 1),
    onChange: () => undefined,
    onNotice: (message) => record.notices.push(message),
  };
  return { store, context, record };
}

/** Modifiers of a pointer input. */
export interface Modifiers {
  /** Shift. */
  readonly isShift?: boolean;
  /** Alt (the snap modifier). */
  readonly isAlt?: boolean;
}

/**
 * A pointer input at zoom 1, where screen and world points are equal.
 *
 * @param kind - The kind.
 * @param point - Where, world units and CSS px.
 * @param modifiers - Shift and Alt.
 * @returns The input.
 */
export function pointer(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
  modifiers: Modifiers = {},
): Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }> {
  return {
    kind,
    zoom: 1,
    screen: point,
    world: point,
    isShiftPressed: modifiers.isShift ?? false,
    isModPressed: false,
    isSnapSuspended: modifiers.isAlt ?? false,
  };
}

/**
 * A click: press and release at one point.
 *
 * @param mode - The mode.
 * @param point - Where.
 * @param modifiers - Shift and Alt.
 */
export function click(mode: ToolMode, point: Point, modifiers: Modifiers = {}): void {
  mode.onPointer(pointer('pointerDown', point, modifiers));
  mode.onPointer(pointer('pointerUp', point, modifiers));
}

/**
 * A drag: press at one point, move to another in steps, release there.
 *
 * @param mode - The mode.
 * @param from - The press.
 * @param to - The release.
 * @param modifiers - Shift and Alt, held through the drag.
 */
export function drag(mode: ToolMode, from: Point, to: Point, modifiers: Modifiers = {}): void {
  mode.onPointer(pointer('pointerDown', from, modifiers));
  for (const step of [0.5, 1]) {
    const at = { x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step };
    mode.onPointer(pointer('pointerMove', at, modifiers));
  }
  mode.onPointer(pointer('pointerUp', to, modifiers));
}

/**
 * The only path on a store's board.
 *
 * @param store - The store.
 * @returns The path.
 * @throws {Error} When the board does not hold exactly one path.
 */
export function onlyPath(store: YjsDocumentStore): BoardObjectOf<'path'> {
  const paths = [...store.read().objects.values()].filter((object) => object.type === 'path');
  const [path] = paths;
  if (paths.length !== 1 || path?.type !== 'path') {
    throw new Error(`expected one path, found ${String(paths.length)}`);
  }
  return path;
}

/**
 * A path at (100, 100) for the vector-edit tests: a straight three-vertex chain, or with
 * `closed` a square loop, stroked and optionally filled.
 *
 * @param overrides - Fields to change.
 * @returns The path.
 */
export function testPath(overrides: Partial<BoardObjectOf<'path'>> = {}): BoardObjectOf<'path'> {
  const zero = { x: 0, y: 0 };
  return {
    id: 'path-1' as ObjectId,
    type: 'path',
    parentId: null,
    x: 100,
    y: 100,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: ADA.principalId,
    createdAt: 1,
    updatedAt: 1,
    vertices: [
      { id: 'v1', x: 0, y: 0, mirror: 'none' },
      { id: 'v2', x: 100, y: 0, mirror: 'both' },
      { id: 'v3', x: 200, y: 0, mirror: 'none' },
    ],
    segments: [
      { id: 's1', a: 'v1', b: 'v2', ha: zero, hb: { x: -30, y: 0 } },
      { id: 's2', a: 'v2', b: 'v3', ha: { x: 30, y: 0 }, hb: zero },
    ],
    stroke: { color: [0.1, 0.1, 0.1, 1], width: 2 },
    fill: null,
    ...overrides,
  };
}

/**
 * A filled square loop, 100 on a side, at (100, 100).
 *
 * @returns The path.
 */
export function squarePath(): BoardObjectOf<'path'> {
  const zero = { x: 0, y: 0 };
  const corners = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ] as const;
  return testPath({
    vertices: corners.map(([x, y], index) => ({ id: `c${String(index)}`, x, y, mirror: 'none' })),
    segments: corners.map((corner, index) => ({
      id: `e${String(index)}`,
      a: `c${String(index)}`,
      b: `c${String((index + 1) % 4)}`,
      ha: zero,
      hb: zero,
    })),
    fill: [1, 0, 0, 1],
  });
}
