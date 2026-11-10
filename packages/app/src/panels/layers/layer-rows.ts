import { sortedSiblings, type BoardReader } from '@canvas/document';
import {
  isStoredHidden,
  type BoardObject,
  type ObjectId,
  type ObjectType,
  type ShapeObject,
} from '@canvas/schema';

/** One row of the layers panel: an object at its place in the tree. */
export interface LayerRow {
  /** The object. */
  readonly id: ObjectId;
  /** Its type. */
  readonly type: ObjectType;
  /** The shape's kind, so its row can show the matching icon. */
  readonly shapeKind?: ShapeObject['kind'];
  /** What the row says (`layerNameOf`). */
  readonly name: string;
  /** Its parent, or null at the board's root. */
  readonly parentId: ObjectId | null;
  /** Its level in the tree, 1 at the root (`aria-level`). */
  readonly level: number;
  /** Its place among its siblings, top first, from 1 (`aria-posinset`). */
  readonly positionInSet: number;
  /** How many siblings it has, itself included (`aria-setsize`). */
  readonly setSize: number;
  /** Whether it is a frame, group or main with children, which the row can expand. */
  readonly hasChildren: boolean;
  /** Whether its children are listed below it. */
  readonly isExpanded: boolean;
  /** Whether it is locked. */
  readonly isLocked: boolean;
  /** Whether it is stored hidden: not drawn, not hit on the canvas. */
  readonly isHidden: boolean;
}

/** The name of each type, for objects without one of their own. */
const TYPE_NAMES: Readonly<Record<ObjectType, string>> = {
  text: 'Text',
  sticky: 'Sticky note',
  image: 'Image',
  video: 'Video',
  shape: 'Shape',
  line: 'Line',
  connector: 'Connector',
  path: 'Path',
  freehand: 'Drawing',
  link: 'Link',
  group: 'Group',
  frame: 'Frame',
  comment: 'Comment',
  component: 'Component',
  instance: 'Instance',
};

/** The longest text a row shows of a text or sticky, characters. */
const NAME_LENGTH = 40;

/**
 * The first line of a text, cut to the row's length.
 *
 * @param text - The text.
 * @returns The line, or an empty string.
 */
function firstLine(text: string): string {
  const end = text.indexOf('\n');
  const line = (end === -1 ? text : text.slice(0, end)).trim();
  return line.length > NAME_LENGTH ? `${line.slice(0, NAME_LENGTH - 1)}…` : line;
}

/**
 * What a layers row calls an object: its own layer name when it has one (a frame's or a
 * main's), else the first line of a text or sticky, a shape's kind, or its type.
 *
 * @param object - The object.
 * @returns The name, never empty.
 */
export function layerNameOf(object: BoardObject): string {
  const own = object.name?.trim();
  if (own !== undefined && own !== '') return own;
  switch (object.type) {
    case 'text':
    case 'sticky':
      return firstLine(object.text) || TYPE_NAMES[object.type];
    case 'shape':
      return object.kind.charAt(0).toUpperCase() + object.kind.slice(1);
    default:
      return TYPE_NAMES[object.type];
  }
}

/**
 * Whether objects of a type hold children the tree can list: frames, groups and mains, whose
 * real children are listed and edited as a frame's (ruling 7). An instance does not: its
 * content is its main's, drawn but never listed under it.
 *
 * @param type - The type.
 * @returns True for frames, groups and mains.
 */
export function isContainerType(type: ObjectType): boolean {
  return type === 'frame' || type === 'group' || type === 'component';
}

/**
 * Whether an object holds children the tree can list (`isContainerType`).
 *
 * @param object - The object.
 * @returns True for frames, groups and mains.
 */
export function isContainer(object: BoardObject): boolean {
  return isContainerType(object.type);
}

/** Where a row sits in the tree: what {@link layerRowOf} needs besides the object. */
export interface LayerRowPlace {
  /** The object's parent, or null at the root. */
  readonly parentId: ObjectId | null;
  /** Its level, 1 at the root. */
  readonly level: number;
  /** Its place among its siblings, top first, from 1. */
  readonly positionInSet: number;
  /** How many siblings it has, itself included. */
  readonly setSize: number;
}

/**
 * An object's row at a place in the tree; `previous` itself when it already says all that, so
 * an unchanged row keeps its identity.
 *
 * @param board - The document.
 * @param expanded - The frames and groups whose children are listed.
 * @param object - The object.
 * @param place - Its parent, level and place among its siblings.
 * @param previous - The object's row before, if it had one.
 * @returns The row.
 */
export function layerRowOf(
  board: BoardReader,
  expanded: ReadonlySet<ObjectId>,
  object: BoardObject,
  place: LayerRowPlace,
  previous?: LayerRow,
): LayerRow {
  const hasChildren = isContainer(object) && board.references.childrenOf(object.id).size > 0;
  const row: LayerRow = {
    id: object.id,
    type: object.type,
    ...(object.type === 'shape' ? { shapeKind: object.kind } : {}),
    name: layerNameOf(object),
    parentId: place.parentId,
    level: place.level,
    positionInSet: place.positionInSet,
    setSize: place.setSize,
    hasChildren,
    isExpanded: hasChildren && expanded.has(object.id),
    isLocked: object.locked,
    isHidden: isStoredHidden(object),
  };
  return previous !== undefined && isSameRow(previous, row) ? previous : row;
}

/**
 * Whether two rows say the same.
 *
 * @param first - A row.
 * @param second - Another.
 * @returns True when every field is equal.
 */
function isSameRow(first: LayerRow, second: LayerRow): boolean {
  return (
    first.id === second.id &&
    first.type === second.type &&
    first.shapeKind === second.shapeKind &&
    first.name === second.name &&
    first.parentId === second.parentId &&
    first.level === second.level &&
    first.positionInSet === second.positionInSet &&
    first.setSize === second.setSize &&
    first.hasChildren === second.hasChildren &&
    first.isExpanded === second.isExpanded &&
    first.isLocked === second.isLocked &&
    first.isHidden === second.isHidden
  );
}

/**
 * The layers panel's rows: the board's root objects in paint order,
 * top first (`sortedSiblings` reversed), each expanded frame or group followed by its children
 * the same way. O(listed objects × log siblings); collapsed containers cost nothing inside. The
 * reference `LayerTree` keeps its rows equal to, splicing only what a change touches.
 *
 * @param board - The document.
 * @param expanded - The frames and groups whose children are listed.
 * @returns The rows, top to bottom.
 */
export function buildLayerRows(board: BoardReader, expanded: ReadonlySet<ObjectId>): LayerRow[] {
  const rows: LayerRow[] = [];
  const addChildren = (parentId: ObjectId | null, level: number) => {
    const children = sortedSiblings(board, parentId).reverse();
    children.forEach((id, index) => {
      const object = board.get(id);
      if (object === undefined) return;
      const place = { parentId, level, positionInSet: index + 1, setSize: children.length };
      const row = layerRowOf(board, expanded, object, place);
      rows.push(row);
      if (row.isExpanded) addChildren(id, level + 1);
    });
  };
  addChildren(null, 1);
  return rows;
}
