import { planGroupResize, worldBoxOf } from '@canvas/document';
import type { BoardObject, ObjectId, Point } from '@canvas/schema';

/** A field of the inspector's layout section: position, size or rotation. */
export type LayoutField = 'x' | 'y' | 'width' | 'height' | 'rotation';

/** What the layout section reads of the board: objects by id and, for groups, their children. */
export interface LayoutReader {
  /**
   * An object by id.
   *
   * @param id - The id.
   * @returns The object, or undefined.
   */
  get(id: ObjectId): BoardObject | undefined;
  /** The parent index, for a group's children; a group is measured by its origin without it. */
  readonly references?: {
    /**
     * The ids of an object's children.
     *
     * @param id - The parent.
     * @returns The children's ids.
     */
    childrenOf(id: ObjectId): Iterable<ObjectId>;
  };
}

/** Where an object is, as the layout section shows it. */
export interface LayoutBox {
  /** The left of its box on the board, world units (rotation applied). */
  readonly x: number;
  /** The top of its box on the board, world units. */
  readonly y: number;
  /**
   * Its width, world units: a boxed object's stored width, a group's derived box's, else the
   * width of its box on the board.
   */
  readonly width: number;
  /** Its height, world units, as {@link LayoutBox.width}. */
  readonly height: number;
  /** Its rotation in its parent's frame, degrees clockwise. */
  readonly rotation: number;
  /**
   * Whether `resizeObjects` takes it (a boxed object or a group): lines, paths, connectors and
   * comments have no box to resize, so their size is shown but not edited.
   */
  readonly canResize: boolean;
}

/** An axis-aligned box on the board, world units. */
interface Extent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The types that store a box, which `resizeObjects` sets (lines, paths, connectors, comments do not). */
const BOXED_TYPES: ReadonlySet<BoardObject['type']> = new Set([
  'text',
  'sticky',
  'image',
  'video',
  'shape',
  'frame',
  'component',
  'instance',
]);

/** How deep a group's nesting is followed before it counts as a cycle. */
const MAX_DEPTH = 64;

/**
 * The box on the board of an object and, for a group, of everything under it: the union of its
 * descendants' boxes, or its origin when it holds nothing (or the reader has no parent index).
 *
 * @param board - The board.
 * @param object - The object.
 * @param depth - How deep in groups the walk is.
 * @returns The box, or undefined when it cannot be worked out.
 */
function extentOf(board: LayoutReader, object: BoardObject, depth = 0): Extent | undefined {
  if (object.type === 'group' && board.references !== undefined && depth < MAX_DEPTH) {
    let union: Extent | undefined;
    for (const id of board.references.childrenOf(object.id)) {
      const child = board.get(id);
      const box = child === undefined ? undefined : extentOf(board, child, depth + 1);
      if (box === undefined) continue;
      union =
        union === undefined
          ? box
          : {
              minX: Math.min(union.minX, box.minX),
              minY: Math.min(union.minY, box.minY),
              maxX: Math.max(union.maxX, box.maxX),
              maxY: Math.max(union.maxY, box.maxY),
            };
    }
    if (union !== undefined) return union;
  }
  const world = worldBoxOf(board, object);
  return world.kind === 'box' ? world.box : undefined;
}

/**
 * A group's derived box's size along its own axes, as `resizeObjects` scales it.
 *
 * @param board - The board, with its parent index.
 * @param group - The group.
 * @returns The size, or undefined without a parent index.
 */
function groupSizeOf(
  board: LayoutReader,
  group: BoardObject,
): { width: number; height: number } | undefined {
  const { references } = board;
  if (references === undefined) return undefined;
  const tree = {
    get: (id: ObjectId) => board.get(id),
    childrenOf: (id: ObjectId) => references.childrenOf(id),
  };
  return planGroupResize(tree, group, { by: { width: 0, height: 0 } }).before;
}

/**
 * Rounds a number for a field: two decimal places, no negative zero.
 *
 * @param value - The number.
 * @returns The rounded number.
 */
export function roundForField(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Where an object is, as the layout section shows it: its box's left and top on the
 * board, its size and its rotation, each rounded to two decimal places. Pure: reads the board.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The box, or undefined when its place cannot be worked out.
 */
export function layoutBoxOf(board: LayoutReader, object: BoardObject): LayoutBox | undefined {
  const extent = extentOf(board, object);
  if (extent === undefined) return undefined;
  const isBoxed = BOXED_TYPES.has(object.type) && 'width' in object && 'height' in object;
  const size =
    object.type === 'group'
      ? (groupSizeOf(board, object) ?? {
          width: extent.maxX - extent.minX,
          height: extent.maxY - extent.minY,
        })
      : isBoxed
        ? { width: object.width, height: object.height }
        : { width: extent.maxX - extent.minX, height: extent.maxY - extent.minY };
  return {
    x: roundForField(extent.minX),
    y: roundForField(extent.minY),
    width: roundForField(size.width),
    height: roundForField(size.height),
    rotation: roundForField((object.rotation * 180) / Math.PI),
    canResize: isBoxed || object.type === 'group',
  };
}

/**
 * The centre of an object's box on the board, the point the rotation field turns it about.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The centre, or undefined when its place cannot be worked out.
 */
function centreOf(board: LayoutReader, object: BoardObject): Point | undefined {
  const extent = extentOf(board, object);
  return extent === undefined
    ? undefined
    : { x: (extent.minX + extent.maxX) / 2, y: (extent.minY + extent.maxY) / 2 };
}

/**
 * The existing command a layout field's committed value runs, with its input: the
 * command layer's `moveObjects`, `resizeObjects` or `rotateObjects`, one command and so one undo
 * step for every object it changes.
 */
export type LayoutCommand =
  | {
      /** `moveObjects`: X or Y, each object moved by what puts its box's left or top there. */
      readonly kind: 'move';
      readonly input: {
        readonly moves: { id: ObjectId; by: Point }[];
      };
    }
  | {
      /** `resizeObjects`: W or H, each boxed object and group resized, its other side kept. */
      readonly kind: 'resize';
      readonly input: {
        readonly resizes: { id: ObjectId; to: { width: number; height: number } }[];
      };
    }
  | {
      /** `rotateObjects`: each object turned about its box's centre to the angle given. */
      readonly kind: 'rotate';
      readonly input: {
        readonly rotations: { id: ObjectId; by: number; about: Point }[];
      };
    };

/**
 * Plans what a layout field's committed value does to objects: X and Y move each
 * object so its box's left or top is at the value; W and H resize each object `resizeObjects`
 * takes to the value, its other side kept; rotation turns each object about its box's centre to
 * the value, degrees clockwise. Objects already there, and objects that cannot take the change,
 * are left out. Pure.
 *
 * @param board - The board.
 * @param objects - The objects, as stored.
 * @param field - The field.
 * @param value - The value committed.
 * @returns The command and its input, or undefined when nothing would change.
 */
export function planLayoutChange(
  board: LayoutReader,
  objects: readonly BoardObject[],
  field: LayoutField,
  value: number,
): LayoutCommand | undefined {
  const measured = objects.flatMap((object) => {
    const box = layoutBoxOf(board, object);
    return box === undefined ? [] : [{ object, box }];
  });
  switch (field) {
    case 'x':
    case 'y': {
      const moves = measured.flatMap(({ object, box }) => {
        const delta = value - box[field];
        if (delta === 0) return [];
        return [{ id: object.id, by: field === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta } }];
      });
      return moves.length === 0 ? undefined : { kind: 'move', input: { moves } };
    }
    case 'width':
    case 'height': {
      const resizes = measured.flatMap(({ object, box }) => {
        if (!box.canResize || box[field] === value) return [];
        const to = { width: box.width, height: box.height, [field]: value };
        return [{ id: object.id, to }];
      });
      return resizes.length === 0 ? undefined : { kind: 'resize', input: { resizes } };
    }
    case 'rotation': {
      const target = (value * Math.PI) / 180;
      const rotations = measured.flatMap(({ object, box }) => {
        const about = centreOf(board, object);
        if (box.rotation === value || about === undefined) return [];
        return [{ id: object.id, by: target - object.rotation, about }];
      });
      return rotations.length === 0 ? undefined : { kind: 'rotate', input: { rotations } };
    }
  }
}
