// A draw tool's context over a real document store, empty unless given objects, for the draw
// tool's tests: previews, undo steps, exit requests and refusals are recorded, new ids are
// numbered, and the eraser finds candidates through a spatial index kept in step with the store.
import type { CommandError, YjsDocumentStore } from '@canvas/document';
import type { BoardObject, FreehandObject, ObjectId, PrincipalId } from '@canvas/schema';

import { indexOf } from '../../select/__fixtures__/select-board.js';
import { ADA, createSelectStore, NOW } from '../../select/__fixtures__/select-store.js';
import type { DrawModeContext } from '../draw-context.js';
import type { DrawStyle } from '../draw-style.js';

/** What the context recorded. */
export interface DrawToolRecord {
  /** The preview shown per object; `undefined` once dropped. */
  readonly previews: Map<ObjectId, BoardObject | undefined>;
  /** How many times each preview id was set (shown or dropped). */
  readonly previewWrites: ObjectId[];
  /** Refused commands' errors. */
  readonly refusals: (readonly CommandError[])[];
  /** Undo steps opened through `capture.command`. */
  commands: number;
  /** How many times the mode asked to end. */
  exitRequests: number;
}

/** The pencil in these tests: black, 2 wide. */
export const PENCIL: DrawStyle = { tool: 'pencil', stroke: { color: [0, 0, 0, 1], width: 2 } };

/** The eraser in these tests: the pencil's look, erasing. */
export const ERASER: DrawStyle = { ...PENCIL, isEraser: true };

/** A stroke's placement and look in {@link strokeObject}. */
export interface StrokePlacement {
  /** Its parent; the board when absent. */
  readonly parentId?: string;
  /** Its place in the parent's frame; the origin when absent. */
  readonly x?: number;
  readonly y?: number;
  /** Its rotation, radians. */
  readonly rotation?: number;
  /** Its width; 2 when absent. */
  readonly width?: number;
  readonly isLocked?: boolean;
  readonly isHidden?: boolean;
  readonly opacity?: number;
}

/**
 * A pencil stroke through points, in its own frame.
 *
 * @param objectId - Its id.
 * @param points - Its flat x, y pairs.
 * @param placement - Where it is and how it looks.
 * @returns The stroke.
 */
export function strokeObject(
  objectId: string,
  points: readonly number[],
  placement: StrokePlacement = {},
): FreehandObject {
  return {
    id: objectId as ObjectId,
    type: 'freehand',
    parentId: placement.parentId === undefined ? null : (placement.parentId as ObjectId),
    x: placement.x ?? 0,
    y: placement.y ?? 0,
    rotation: placement.rotation ?? 0,
    z: 'a0',
    locked: placement.isLocked ?? false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: NOW,
    updatedAt: NOW,
    tool: 'pencil',
    points: [...points],
    stroke: { color: [0, 0, 0, 1], width: placement.width ?? 2 },
    ...(placement.isHidden === undefined ? {} : { isHidden: placement.isHidden }),
    ...(placement.opacity === undefined ? {} : { opacity: placement.opacity }),
  };
}

/**
 * A draw tool context over a board.
 *
 * @param style - The tool's style; {@link PENCIL} by default.
 * @param objects - What the board holds; nothing by default.
 * @returns The store, the context and what it recorded.
 */
export function drawToolContext(
  style: DrawStyle = PENCIL,
  objects: readonly BoardObject[] = [],
): {
  readonly store: YjsDocumentStore;
  readonly context: DrawModeContext;
  readonly record: DrawToolRecord;
} {
  const store = createSelectStore(objects);
  const board = (): BoardObject[] => [...store.read().objects.values()];
  const record: DrawToolRecord = {
    previews: new Map(),
    previewWrites: [],
    refusals: [],
    commands: 0,
    exitRequests: 0,
  };
  let nextId = 0;
  const context: DrawModeContext = {
    store,
    origin: ADA,
    environment: {
      clock: () => NOW,
      createId: () => `new-${String((nextId += 1))}` as ObjectId,
    },
    capture: {
      command: (run) => {
        record.commands += 1;
        run();
      },
    },
    setPreview: (id, object) => {
      record.previews.set(id, object);
      record.previewWrites.push(id);
    },
    onChange: () => undefined,
    onCommandRefused: (errors) => {
      record.refusals.push(errors);
    },
    drawStyle: () => style,
    requestExit: () => {
      record.exitRequests += 1;
    },
    source: { get: (objectId) => store.get(objectId) },
    hitIndex: { searchRect: (rect) => indexOf(board()).searchRect(rect) },
  };
  return { store, context, record };
}

/**
 * The freehand objects a store holds, in no particular order.
 *
 * @param store - The store.
 * @returns Its strokes.
 */
export function strokesIn(store: YjsDocumentStore): FreehandObject[] {
  return [...store.read().objects.values()].filter(
    (object): object is FreehandObject => object.type === 'freehand',
  );
}
