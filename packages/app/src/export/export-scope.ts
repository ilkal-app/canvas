import { comparePaintOrder } from '@canvas/document';
import type { CaptureRect } from '@canvas/engine';
import {
  boardTransformOf,
  buildChildIndex,
  geometryBoxOf,
  isFiniteBox,
  isStoredHidden,
  shownPageIdOf,
  type Board,
  type BoardObject,
  type ChildIndex,
  type ExtentBox,
  type ObjectId,
  type PageId,
} from '@canvas/schema';

import { definitionClosure } from '../collab/instance-projection.js';

/** What an export draws: the page shown, or the objects selected. */
export type ExportRequest =
  | {
      /** The whole page. */
      readonly kind: 'page';
      /** The page. */
      readonly pageId: PageId;
    }
  | {
      /** The objects selected. */
      readonly kind: 'selection';
      /** Their ids; unknown ones are ignored. */
      readonly ids: readonly ObjectId[];
    };

/** An export's objects and area. */
export interface ExportScope {
  /** Whether it is the page (`board`) or a selection. */
  readonly kind: 'board' | 'selection';
  /** The area drawn, board units: the shown objects' bounds, unpadded. */
  readonly rect: CaptureRect;
  /**
   * The objects the capture is given: the shown ones, their ancestors (which place them) and the
   * mains of the instances among them with the mains' content, each once.
   */
  readonly objects: readonly BoardObject[];
  /** The objects that draw. */
  readonly shownIds: ReadonlySet<ObjectId>;
}

/**
 * Every descendant of the objects, through the child index, each once.
 *
 * @param children - The board's child index.
 * @param ids - The objects.
 * @param into - Where they go; the objects themselves are added too.
 * @returns `into`.
 */
function withDescendants(
  children: ChildIndex,
  ids: Iterable<ObjectId>,
  into = new Set<ObjectId>(),
): Set<ObjectId> {
  const stack = [...ids];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (into.has(id)) continue;
    into.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return into;
}

/**
 * The board box of an object as the canvas draws it: its own geometry placed through its
 * parents, or, for an object with none of its own (a group), the union of its shown children's
 * (a hidden child draws nothing, so it bounds nothing).
 *
 * @param board - The board.
 * @param children - Its child index.
 * @param shownIds - The objects that draw.
 * @param object - The object.
 * @returns The box, or undefined when nothing of it can be placed.
 */
function boxOf(
  board: Board,
  children: ChildIndex,
  shownIds: Pick<ReadonlySet<ObjectId>, 'has'>,
  object: BoardObject,
): ExtentBox | undefined {
  const transform = boardTransformOf(object, (id) => board.objects.get(id));
  const own = transform === undefined ? undefined : geometryBoxOf(object, transform);
  if (own !== undefined) return isFiniteBox(own) ? own : undefined;
  let union: ExtentBox | undefined;
  for (const childId of children.get(object.id) ?? []) {
    const child = shownIds.has(childId) ? board.objects.get(childId) : undefined;
    const box = child === undefined ? undefined : boxOf(board, children, shownIds, child);
    if (box !== undefined) union = union === undefined ? box : unionOf(union, box);
  }
  return union;
}

/**
 * The smallest box holding two boxes.
 *
 * @param a - One box.
 * @param b - The other.
 * @returns Their union.
 */
function unionOf(a: ExtentBox, b: ExtentBox): ExtentBox {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * The ids shown for a request: a page's objects, or the selected objects with their content and,
 * for a selected section, what lies on it (`lyingOn`, item 9); only those the canvas
 * draws (no comment pins, nothing hidden or in a retired main).
 *
 * @param board - The board.
 * @param children - Its child index.
 * @param request - The request.
 * @returns The ids.
 */
function shownIdsOf(board: Board, children: ChildIndex, request: ExportRequest): Set<ObjectId> {
  if (request.kind === 'page') {
    const ids = new Set<ObjectId>();
    for (const object of board.objects.values()) {
      if (shownPageIdOf(board, object) === request.pageId) ids.add(object.id);
    }
    return drawnOf(board, ids);
  }
  const known = request.ids.filter((id) => board.objects.has(id));
  const selected = withDescendants(children, known);
  // A selected section takes what lies on it too (item 9): objects drawn on it before
  // creation joined the section under it are still root objects there.
  const lying = known.flatMap((id) => lyingOn(board, children, board.objects.get(id)));
  return drawnOf(board, withDescendants(children, lying, selected));
}

/**
 * The page an object's root ancestor names (the stored `pageId`, not the page it falls back to
 * when the board does not list it).
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The page, or undefined.
 */
function storedPageOf(board: Board, object: BoardObject): BoardObject['pageId'] {
  const walked = new Set<ObjectId>();
  let at = object;
  while (at.parentId !== null && !walked.has(at.id)) {
    walked.add(at.id);
    const parent = board.objects.get(at.parentId);
    if (parent === undefined) break;
    at = parent;
  }
  return at.pageId;
}

/**
 * The root objects that lie on a frame without being its children (item 9): on its
 * page, painted above it, the centre of their box as the canvas draws it (a group's, its drawn
 * children's) inside the frame's box, turned with it. Made before a new object joined the
 * section it was drawn in, they belong to it as the board shows it.
 *
 * @param board - The board.
 * @param children - Its child index.
 * @param frame - A selected object; only a frame has anything lying on it.
 * @returns The objects' ids.
 */
function lyingOn(board: Board, children: ChildIndex, frame: BoardObject | undefined): ObjectId[] {
  if (frame?.type !== 'frame') return [];
  const lookup = (id: ObjectId): BoardObject | undefined => board.objects.get(id);
  const transform = boardTransformOf(frame, lookup);
  if (transform === undefined) return [];
  const isInside = (x: number, y: number): boolean => {
    const dx = x - transform.x;
    const dy = y - transform.y;
    const along = transform.cos * dx + transform.sin * dy;
    const down = -transform.sin * dx + transform.cos * dy;
    return along >= 0 && down >= 0 && along <= frame.width && down <= frame.height;
  };
  // A group bounds what of it draws (`boxOf`).
  const drawn = {
    has: (id: ObjectId): boolean => {
      const object = lookup(id);
      return object !== undefined && isDrawn(board, object);
    },
  };
  const page = storedPageOf(board, frame);
  const lying: ObjectId[] = [];
  for (const object of board.objects.values()) {
    // A comment pin is never drawn (`isDrawn`).
    if (object.parentId !== null || object.id === frame.id || object.type === 'comment') continue;
    if (object.pageId !== page || comparePaintOrder(board, object, frame) <= 0) {
      continue;
    }
    const box = boxOf(board, children, drawn, object);
    if (box === undefined) continue;
    if (isInside((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2)) lying.push(object.id);
  }
  return lying;
}

/**
 * Whether the canvas draws an object: not a comment pin, and neither it nor any ancestor hidden
 * (`isHidden`) or a retired main. Cycle-safe.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns True when it draws.
 */
function isDrawn(board: Board, object: BoardObject): boolean {
  if (object.type === 'comment') return false;
  const walked = new Set<ObjectId>();
  for (let at: BoardObject | undefined = object; at !== undefined;) {
    if (walked.has(at.id) || isStoredHidden(at)) return false;
    if (at.type === 'component' && at.retired) return false;
    walked.add(at.id);
    at = at.parentId === null ? undefined : board.objects.get(at.parentId);
  }
  return true;
}

/**
 * The ids the canvas draws (`isDrawn`).
 *
 * @param board - The board.
 * @param ids - The ids.
 * @returns A new set of those it draws.
 */
function drawnOf(board: Board, ids: ReadonlySet<ObjectId>): Set<ObjectId> {
  return new Set(
    [...ids].filter((id) => {
      const object = board.objects.get(id);
      return object !== undefined && isDrawn(board, object);
    }),
  );
}

/**
 * The objects an export must send: the shown ones with every ancestor that places them, and
 * what their instances resolve against (`definitionClosure`, as the live projection: each main,
 * its content, the mains of the instances in it and every swap target, with their ancestors).
 *
 * @param board - The board.
 * @param shown - The shown ids.
 * @returns The objects, each once.
 */
function sentObjectsOf(board: Board, shown: ReadonlySet<ObjectId>): BoardObject[] {
  const sent = new Map<ObjectId, BoardObject>();
  for (const id of shown) {
    for (let at = board.objects.get(id); at !== undefined && !sent.has(at.id);) {
      sent.set(at.id, at);
      at = at.parentId === null ? undefined : board.objects.get(at.parentId);
    }
  }
  const shownObjects = [...sent.values()].filter(({ id }) => shown.has(id));
  for (const object of definitionClosure(board, shownObjects)) {
    if (!sent.has(object.id)) sent.set(object.id, object);
  }
  return [...sent.values()];
}

/**
 * What an export of the page or the selection draws: the shown objects (a page's, or
 * the selected ones that exist with their descendants, only those the canvas draws), the objects
 * the capture needs besides them (ancestors, and what instances resolve against: mains, their
 * content and swap targets), and the area: the
 * union of the board boxes of the shown trees' tops, as the canvas draws them, unpadded. Pure;
 * never mutates the board.
 *
 * @param board - The board.
 * @param request - The page or the selection.
 * @returns The scope, or undefined when nothing would be shown.
 */
export function exportScopeOf(board: Board, request: ExportRequest): ExportScope | undefined {
  const children = buildChildIndex(board);
  const shownIds = shownIdsOf(board, children, request);
  let union: ExtentBox | undefined;
  for (const id of shownIds) {
    const object = board.objects.get(id);
    if (object === undefined || (object.parentId !== null && shownIds.has(object.parentId))) {
      continue;
    }
    const box = boxOf(board, children, shownIds, object);
    if (box !== undefined) union = union === undefined ? box : unionOf(union, box);
  }
  if (union === undefined || shownIds.size === 0) return undefined;
  const objects = sentObjectsOf(board, shownIds);
  return {
    kind: request.kind === 'page' ? 'board' : 'selection',
    rect: {
      x: union.minX,
      y: union.minY,
      width: union.maxX - union.minX,
      height: union.maxY - union.minY,
    },
    objects,
    shownIds,
  };
}
