import { comparePaintOrder, type DocumentStore } from '@canvas/document';
import {
  boardTransformOf,
  geometryBoxOf,
  isStoredHidden,
  type Board,
  type BoardObject,
  type ObjectId,
  type Point,
  type RigidTransform,
} from '@canvas/schema';

/** An object to create, as a creation tool makes it: a board object without its id. */
export interface CreationObject {
  /** Its type. */
  readonly type: string;
}

/** One `createObjects` call's objects and the parent they go in (item 9). */
export interface CreationBatch<Created> {
  /** The objects, each `parentId` null when the call's parent holds them. */
  readonly objects: Created[];
  /** The call's parent: the section they were all drawn in, or null for the root. */
  readonly parentId: ObjectId | null;
  /** Where each object was in the objects drawn, in order: its preview's place. */
  readonly indexes: readonly number[];
}

/**
 * Whether an object or one of its ancestors is hidden: what it holds is not drawn.
 * Cycle-safe.
 *
 * @param object - The object.
 * @param lookup - Reads an object by id.
 * @returns Whether it is hidden.
 */
function isHiddenInTree(
  object: BoardObject,
  lookup: (id: ObjectId) => BoardObject | undefined,
): boolean {
  const walked = new Set<ObjectId>();
  for (let at: BoardObject | undefined = object; at !== undefined && !walked.has(at.id);) {
    if (isStoredHidden(at)) return true;
    walked.add(at.id);
    at = at.parentId === null ? undefined : lookup(at.parentId);
  }
  return false;
}

/** The id a new object is read under while it has none of its own. */
const NEW_ID = '__creation__' as ObjectId;

/**
 * The top-most frame under a point that takes new objects (item 9): unlocked, shown on
 * the page the store shows (another page's frames are not in it), neither it nor an ancestor
 * hidden (what it holds would vanish with it), the point inside its box
 * (turned with it), and painted above every other such frame. The rule a drop follows
 * (`landingOf`), read from the board rather than the spatial index. Pure.
 *
 * @param board - The board.
 * @param isShown - Whether the store shows an object (the page shown).
 * @param point - The point, board units.
 * @returns The frame, or undefined over no frame.
 */
export function frameUnderPoint(
  board: Board,
  isShown: (id: ObjectId) => boolean,
  point: Point,
): BoardObject | undefined {
  const lookup = (id: ObjectId): BoardObject | undefined => board.objects.get(id);
  let top: BoardObject | undefined;
  for (const object of board.objects.values()) {
    if (object.type !== 'frame' || object.locked || !isShown(object.id)) continue;
    if (isHiddenInTree(object, lookup)) continue;
    const transform = boardTransformOf(object, lookup);
    if (transform === undefined) continue;
    const dx = point.x - transform.x;
    const dy = point.y - transform.y;
    const x = transform.cos * dx + transform.sin * dy;
    const y = -transform.sin * dx + transform.cos * dy;
    if (x < 0 || y < 0 || x > object.width || y > object.height) continue;
    if (top === undefined || comparePaintOrder(board, object, top) > 0) top = object;
  }
  return top;
}

/**
 * A root object's placement in a frame's coordinates, so it stays where it is on the board: its
 * origin taken through the frame's board transform, and its rotation less the frame's, in
 * (-π, π] as stored rotations are.
 *
 * @param object - The root object.
 * @param toBoard - The frame's board transform.
 * @returns Its x, y and rotation in the frame.
 */
function inFrame(
  object: BoardObject,
  toBoard: RigidTransform,
): { readonly x: number; readonly y: number; readonly rotation: number } {
  const dx = object.x - toBoard.x;
  const dy = object.y - toBoard.y;
  // Wrapped into (-π, π] as the document's `normalizeAngle` does.
  const wrapped = (object.rotation - Math.atan2(toBoard.sin, toBoard.cos)) % (2 * Math.PI);
  const rotation =
    wrapped > Math.PI
      ? wrapped - 2 * Math.PI
      : wrapped <= -Math.PI
        ? wrapped + 2 * Math.PI
        : wrapped;
  return {
    x: toBoard.cos * dx + toBoard.sin * dy,
    y: -toBoard.sin * dx + toBoard.cos * dy,
    rotation,
  };
}

/**
 * A new object placed in the section it is drawn in (item 9): a root object whose box
 * centre lies in a frame (`frameUnderPoint`) becomes that frame's child, its position and
 * rotation converted so it stays where it was drawn (`inFrame`), with no page of its own (a
 * child takes its parent's). A connector, whose ends may be anywhere, an object already given a
 * parent, and one over no frame are returned as they are. Pure: reads the store.
 *
 * @param store - The board as the page shown has it.
 * @param object - The object to create, in board units, without an id.
 * @returns The object to create.
 */
export function withCreationParent<Created extends CreationObject>(
  store: Pick<DocumentStore, 'read' | 'get'>,
  object: Created,
): Created {
  const candidate = { ...object, id: NEW_ID } as unknown as BoardObject;
  if (candidate.type === 'connector' || candidate.parentId !== null) return object;
  const own = boardTransformOf(candidate, () => undefined);
  const box = own === undefined ? undefined : geometryBoxOf(candidate, own);
  if (box === undefined) return object;
  const board = store.read();
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const frame = frameUnderPoint(board, (id) => store.get(id) !== undefined, centre);
  if (frame === undefined) return object;
  const toBoard = boardTransformOf(frame, (id) => board.objects.get(id));
  if (toBoard === undefined) return object;
  const placement = inFrame(candidate, toBoard);
  const rest = Object.fromEntries(Object.entries(object).filter(([field]) => field !== 'pageId'));
  return { ...rest, ...placement, parentId: frame.id } as unknown as Created;
}

/**
 * New objects made by one gesture (a stroke's pieces) placed each in the section its centre is
 * in (item 9), as `createObjects` calls, whose listed objects take the call's
 * `parentId`: one call per section, its objects in that frame's coordinates (`withCreationParent`)
 * with their own `parentId` null, and one for those at the root, as drawn, in the order the
 * objects were drawn. The caller runs them in one undo step. Pure: reads the store.
 *
 * @param store - The board as the page shown has it.
 * @param objects - The objects to create, in board units.
 * @returns The calls, each with its objects' places among those drawn.
 */
export function withCreationParentGroups<Created extends CreationObject>(
  store: Pick<DocumentStore, 'read' | 'get'>,
  objects: readonly Created[],
): CreationBatch<Created>[] {
  const groups = new Map<ObjectId | null, { objects: Created[]; indexes: number[] }>();
  objects.forEach((object, index) => {
    const placed = withCreationParent(store, object);
    const { parentId } = placed as unknown as { readonly parentId: ObjectId | null };
    const group = groups.get(parentId) ?? { objects: [], indexes: [] };
    group.objects.push(parentId === null ? object : { ...placed, parentId: null });
    group.indexes.push(index);
    groups.set(parentId, group);
  });
  return [...groups].map(([parentId, group]) => ({ ...group, parentId }));
}
