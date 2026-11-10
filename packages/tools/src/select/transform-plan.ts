import {
  moveObjectsCommand,
  planGroupResize,
  resizeObjectsCommand,
  rotateObjectsCommand,
  runCommand,
  type CommandEnvironment,
  type CommandOutcome,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { worldTransformOf } from '@canvas/engine';
import {
  applyTransform,
  invertTransform,
  type BoardObject,
  type ObjectId,
  type Point,
  type Rect,
  type RigidTransform,
} from '@canvas/schema';

import { nearIds } from './far-objects.js';
import {
  boxPointToWorld,
  normalizeAngle,
  rotatePointAbout,
  worldPointToBox,
  type OrientedBox,
} from './oriented-box.js';
import type { SelectIntent } from './select-intent.js';
import { localRectOf, type SelectionSource } from './selection-geometry.js';

/**
 * Where a resize puts one boxed object or group: its box's turned top-left corner and the
 * box's new size (a group's box is derived from its children).
 */
export interface BoxPlacement {
  /** The object. */
  readonly id: ObjectId;
  /** Its box's new top-left corner (a boxed object's local origin), world units on the board. */
  readonly origin: Point;
  /** Its box's new width, world units. */
  readonly width: number;
  /** Its box's new height, world units. */
  readonly height: number;
}

/**
 * What a transform gesture does to the document, in the terms of the command that will do it:
 * `moveObjects` by a delta, `resizeObjects` to boxes, `rotateObjects` about a pivot. The same
 * plan drives the drag's preview (`previewObjects`) and its one command (`runTransformPlan`),
 * so what is shown is what is stored.
 */
export type TransformPlan =
  | {
      /** A move. */
      readonly kind: 'move';
      /** The objects moved. */
      readonly ids: readonly ObjectId[];
      /** The displacement, world units. */
      readonly delta: Point;
      /**
       * The new parent of each object that changes parent on release: a frame, or
       * `null` for the root. Set only at release (`withDropTargets`); a drag's preview keeps
       * every object in its parent.
       */
      readonly parentIds?: ReadonlyMap<ObjectId, ObjectId | null>;
    }
  | {
      /** A resize. */
      readonly kind: 'resize';
      /** Where each object goes. */
      readonly boxes: readonly BoxPlacement[];
    }
  | {
      /** A rotation. */
      readonly kind: 'rotate';
      /** The objects turned. */
      readonly ids: readonly ObjectId[];
      /** The turn, radians, clockwise on screen. */
      readonly angle: number;
      /** The fixed point, world units. */
      readonly pivot: Point;
    };

const IDENTITY: RigidTransform = { cos: 1, sin: 0, x: 0, y: 0 };

function parentToWorld(object: BoardObject, source: SelectionSource): RigidTransform {
  const parent = object.parentId === null ? undefined : source.get(object.parentId);
  return parent ? worldTransformOf(parent, source) : IDENTITY;
}

/**
 * Where one boxed object or group goes when its selection frame is resized from `from` to
 * `to`: its box's centre follows the frame's scaling (along the frame's axes), and its sides
 * scale by the length the frame's scaling gives its own axes, so an object turned with the
 * frame (one object, or a multi-selection of unturned ones) scales exactly and a turned one
 * inside an unturned frame keeps its rotation and stretches along its own axes (exact at
 * quarter turns).
 *
 * @param object - The object, which stores a box or is a group.
 * @param box - Its box in its own frame: `(0, 0)` and its size, or a group's derived box.
 * @param frames - The frame before and after (the same rotation), world units.
 * @param frames.from - The frame before.
 * @param frames.to - The frame after.
 * @param source - The document, for the object's ancestors.
 * @returns The placement.
 */
function placeInResizedFrame(
  object: BoardObject,
  box: Rect,
  frames: { readonly from: OrientedBox; readonly to: OrientedBox },
  source: SelectionSource,
): BoxPlacement {
  const { from, to } = frames;
  const transform = worldTransformOf(object, source);
  const rotation = Math.atan2(transform.sin, transform.cos);
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;
  const centre = applyTransform(transform, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  const inFrame = worldPointToBox(from, centre);
  const movedCentre = boxPointToWorld(to, { x: inFrame.x * scaleX, y: inFrame.y * scaleY });
  const turn = rotation - from.rotation;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const width = box.width * Math.hypot(scaleX * cos, scaleY * sin);
  const height = box.height * Math.hypot(scaleX * sin, scaleY * cos);
  const halfDiagonal = boxPointToWorld(
    { x: 0, y: 0, width, height, rotation },
    { x: width / 2, y: height / 2 },
  );
  return {
    id: object.id,
    origin: { x: movedCentre.x - halfDiagonal.x, y: movedCentre.y - halfDiagonal.y },
    width,
    height,
  };
}

function isSameBox(first: OrientedBox, second: OrientedBox): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

/**
 * Turns a transform intent into the plan of its command, for the movable part of the selection
 * (`nearIds`: no locked objects, no object whose ancestor moves too, none far, which a transform
 * skips). Pure: reads the document as it is, before the gesture's command.
 *
 * @param intent - A `move`, `resize` or `rotate` intent; others plan nothing.
 * @param ids - The selected ids.
 * @param source - The document.
 * @param near - The ids to transform when the caller has them already (the gesture's cached
 *   `SelectionScope`), so a pointer move does not work them out again; `nearIds` otherwise.
 * @returns The plan, or undefined when the gesture changes nothing (no movement, nothing
 *   movable, or an intent that is not a transform).
 */
export function planTransform(
  intent: SelectIntent,
  ids: readonly ObjectId[],
  source: SelectionSource,
  near?: readonly ObjectId[],
): TransformPlan | undefined {
  const movable = near ?? nearIds(ids, source);
  if (movable.length === 0) return undefined;
  switch (intent.type) {
    case 'move':
    case 'nudge':
      if (intent.delta.x === 0 && intent.delta.y === 0) return undefined;
      return { kind: 'move', ids: movable, delta: intent.delta };
    case 'rotate':
      if (intent.angle === 0) return undefined;
      return { kind: 'rotate', ids: movable, angle: intent.angle, pivot: intent.pivot };
    case 'resize': {
      if (isSameBox(intent.from, intent.to)) return undefined;
      const boxes = movable.flatMap((id) => {
        const object = source.get(id);
        const box =
          object?.type === 'group'
            ? localRectOf(id, source)
            : object && 'width' in object
              ? { x: 0, y: 0, width: object.width, height: object.height }
              : undefined;
        return object && box ? [placeInResizedFrame(object, box, intent, source)] : [];
      });
      return { kind: 'resize', boxes };
    }
    default:
      return undefined;
  }
}

/**
 * The objects as a plan's command will leave them (apart from `updatedAt`), for the drag's
 * preview: positions converted from the board into each object's parent frame, as the
 * commands convert them. Pure.
 *
 * @param plan - The plan.
 * @param source - The document before the command.
 * @returns The changed objects, new values; the document's objects are not changed.
 */
export function previewObjects(plan: TransformPlan, source: SelectionSource): BoardObject[] {
  const place = (
    id: ObjectId,
    patch: (object: BoardObject, toParent: RigidTransform) => Readonly<Record<string, number>>,
  ): BoardObject[] => {
    const object = source.get(id);
    if (!object) return [];
    const toParent = invertTransform(parentToWorld(object, source));
    return [{ ...object, ...patch(object, toParent) }];
  };
  const originOf = (object: BoardObject): Point =>
    applyTransform(parentToWorld(object, source), { x: object.x, y: object.y });
  switch (plan.kind) {
    case 'move': {
      const objects: BoardObject[] = [];
      for (const id of plan.ids) {
        const object = source.get(id);
        if (object === undefined) continue;
        const parent = parentToWorld(object, source);
        const toParent = invertTransform(parent);
        const origin = applyTransform(parent, { x: object.x, y: object.y });
        const position = applyTransform(toParent, {
          x: origin.x + plan.delta.x,
          y: origin.y + plan.delta.y,
        });
        objects.push({ ...object, x: position.x, y: position.y });
      }
      return objects;
    }
    case 'rotate':
      return plan.ids.flatMap((id) =>
        place(id, (object, toParent) => ({
          ...applyTransform(toParent, rotatePointAbout(originOf(object), plan.pivot, plan.angle)),
          rotation: normalizeAngle(object.rotation + plan.angle),
        })),
      );
    case 'resize':
      return plan.boxes.flatMap((box) => {
        const group = source.get(box.id);
        if (group?.type !== 'group') {
          return place(box.id, (object, toParent) => ({
            ...applyTransform(toParent, box.origin),
            width: box.width,
            height: box.height,
          }));
        }
        // A group's descendants are what changes: the command's own planner.
        const corner = applyTransform(invertTransform(parentToWorld(group, source)), box.origin);
        const size = { width: box.width, height: box.height };
        return [...planGroupResize(source, group, { to: size, corner }).objects];
      });
  }
}

/**
 * Runs a plan as its one command (`moveObjects`, `resizeObjects` or `rotateObjects`) through
 * `runCommand`: one transaction, one change set, one undo step for the whole gesture, a move's
 * reparents included (`parentIds`).
 *
 * @param store - The document.
 * @param origin - Who the change is attributed to.
 * @param environment - The command clock and id generator.
 * @param plan - The plan.
 * @returns The command's outcome.
 */
export function runTransformPlan(
  store: DocumentStore,
  origin: TransactionOrigin,
  environment: CommandEnvironment,
  plan: TransformPlan,
): CommandOutcome<unknown> {
  switch (plan.kind) {
    case 'move':
      return runCommand(
        store,
        origin,
        moveObjectsCommand,
        {
          moves: plan.ids.map((id) => {
            const parentId = plan.parentIds?.get(id);
            return parentId === undefined
              ? { id, by: plan.delta }
              : { id, by: plan.delta, parentId };
          }),
        },
        environment,
      );
    case 'rotate':
      return runCommand(
        store,
        origin,
        rotateObjectsCommand,
        { rotations: plan.ids.map((id) => ({ id, by: plan.angle, about: plan.pivot })) },
        environment,
      );
    case 'resize':
      return runCommand(
        store,
        origin,
        resizeObjectsCommand,
        {
          resizes: plan.boxes.map(({ id, origin: corner, width, height }) => ({
            id,
            to: { width, height },
            origin: corner,
          })),
        },
        environment,
      );
  }
}
