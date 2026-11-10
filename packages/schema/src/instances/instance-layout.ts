import type { Board } from '../board/board.js';
import type { ChildIndex } from '../board/child-index.js';
import type { AutoLayout } from '../fields/auto-layout.js';
import { isStoredHidden } from '../fields/visibility.js';
import type { BoxSize } from '../geometry/group-resize.js';
import type { ObjectId } from '../ids/object-id.js';
import { layOutStack, stackLayoutOf, type StackNode } from '../layout/stack-layout.js';
import type { BoardObject } from '../objects/board-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { constrainChildren } from './constrain-children.js';
import { effectiveOverrides } from './effective-overrides.js';
import {
  overrideRecordSchema,
  type InstanceOverrides,
  type OverrideRecord,
} from './instance-overrides.js';
import { drawnObject, variantSizedAxes } from './preset-geometry.js';
import { recordAt } from './slot-expansion.js';

/** What a layout reads of a board: objects by id and each container's children. */
export interface LayoutReader {
  /**
   * An object.
   *
   * @param id - Its id.
   * @returns The object, or undefined when there is none.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * A container's children, in no order.
   *
   * @param id - The container.
   * @returns Its child ids.
   */
  childrenOf(id: ObjectId): Iterable<ObjectId>;
}

/** The override record for a child, by its source id; undefined when nothing overrides it. */
type LayoutRecordOf = (id: ObjectId) => OverrideRecord | undefined;

/**
 * Reads an instance's records defensively, as `resolveInstance` does: a record no reader parses
 * (a peer's raw write) changes nothing.
 *
 * @param overrides - The records, by path.
 * @returns Each child's record, by its source id.
 */
function recordsOf(overrides: InstanceOverrides): LayoutRecordOf {
  return (id) => {
    if (!Object.hasOwn(overrides, id)) return undefined;
    const parsed = overrideRecordSchema.safeParse(overrides[id]);
    return parsed.success ? parsed.data : undefined;
  };
}

/** A box: an object with its own width and height, the only kind a stack lays out. */
type Box = Extract<BoardObject, { width: number; height: number }>;

/**
 * Whether an object is a box (it has a stored width and height).
 *
 * @param object - The object.
 * @returns True for a box.
 */
function isBox(object: BoardObject): object is Box {
  return 'width' in object && 'height' in object;
}

/**
 * An object's live auto-layout, when it is a frame or main that has one.
 *
 * @param object - Any object, or nothing.
 * @returns Its auto-layout, or undefined.
 */
export function autoLayoutOf(object: BoardObject | undefined): AutoLayout | undefined {
  return object?.type === 'frame' || object?.type === 'component' ? object.autoLayout : undefined;
}

/**
 * A container's box children in stacking order, bottom first (by `z`, ties by id), as a stack
 * lays them out (2). Lines, paths, connectors, comments and groups keep their own
 * places (v1: only a box has a size to stack).
 *
 * @param reader - The board.
 * @param id - The container.
 * @returns Its box children, bottom first.
 */
function stackedChildren(reader: LayoutReader, id: ObjectId): Box[] {
  const children: Box[] = [];
  for (const childId of reader.childrenOf(id)) {
    const child = reader.get(childId);
    if (child !== undefined && isBox(child)) children.push(child);
  }
  // Ids are unique, so two children never compare equal.
  return children.sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * A child's size in a stack: the measured size an instance's text override carries (
 * decision 3; drawn as stored whether or not it is current, so every renderer agrees), else its
 * own.
 *
 * @param child - The child.
 * @param record - Its override record, if any.
 * @returns Its width and height.
 */
function sizeOf(child: Box, record: OverrideRecord | undefined): BoxSize {
  const measured = record?.measuredSize;
  if (measured !== undefined && (child.type === 'text' || child.type === 'sticky')) {
    return { width: measured.width, height: measured.height };
  }
  return { width: child.width, height: child.height };
}

/**
 * The stack tree of an auto-layout frame or main: its box children in stacking order,
 * each nested auto-layout frame or main as a sub-stack, the others as leaves. When an instance's
 * content is laid out, `recordOf` gives each child's override record: a hidden one (`isHidden`)
 * leaves the flow, with everything under it, and a text or sticky one carrying `measuredSize`
 * takes that size. A child marked `layoutChild.fill` takes the main-axis space left.
 *
 * @param reader - The board.
 * @param container - The frame or main.
 * @param records - An instance's override records by path, when laying out its content; each is
 *   read as `resolveInstance` reads it, and one no reader parses changes nothing.
 * @returns The tree, or undefined when `container` has no auto-layout.
 */
export function autoLayoutTree(
  reader: LayoutReader,
  container: BoardObject,
  records: InstanceOverrides = {},
): StackNode | undefined {
  return treeOf(reader, container, recordsOf(records), false);
}

/**
 * {@link autoLayoutTree} with the records read.
 *
 * @param reader - The board.
 * @param container - The frame or main.
 * @param recordOf - Each child's override record.
 * @param isHidden - Whether the container is hidden, so everything under it is too.
 * @returns The tree, or undefined when `container` has no auto-layout.
 */
function treeOf(
  reader: LayoutReader,
  container: BoardObject,
  recordOf: LayoutRecordOf,
  isHidden: boolean,
): StackNode | undefined {
  const layout = autoLayoutOf(container);
  if (layout === undefined || !isBox(container)) return undefined;
  return {
    key: container.id,
    width: container.width,
    height: container.height,
    layout: stackLayoutOf(layout),
    children: stackedChildren(reader, container.id).map((child) => {
      const record = recordOf(child.id);
      // A record says either way; else the stored visibility.
      const isChildHidden = isHidden || (record?.isHidden ?? isStoredHidden(child));
      const node = treeOf(reader, child, recordOf, isChildHidden) ?? {
        key: child.id,
        ...sizeOf(child, record),
      };
      return {
        ...node,
        ...(child.layoutChild?.fill === true ? { isFilling: true } : {}),
        ...(isChildHidden ? { isHidden: true as const } : {}),
      };
    }),
  };
}

/**
 * The size an instance of an auto-layout main lays out to: its main's stack laid out
 * with the instance's effective override records (hidden children out of the flow, overridden
 * text at its measured size), on each axis the main hugs and the instance has not fixed
 * (`isWidthFixed`, `isHeightFixed`). On an axis the instance has not fixed, a
 * variant's own size (its root preset record's) wins, hug or not, and the stack lays out in it; on
 * an axis other variants size and this one doesn't, the main's own size, or its laid content on a
 * hug axis (`variantSizedAxes`). Every other axis keeps the instance's own.
 *
 * A scaled instance lays its main out in main units, in its box divided by its `scale`,
 * and draws the laid size `scale` times larger; an axis that keeps the instance's own size returns
 * it exactly.
 *
 * @param reader - The board.
 * @param instance - The instance.
 * @param main - Its main.
 * @returns Its width and height.
 */
export function laidInstanceSize(
  reader: LayoutReader,
  instance: InstanceObject,
  main: BoardObject,
): BoxSize {
  const scale = instance.scale ?? 1;
  if (scale === 1) return laidMainUnitSize(reader, instance, main);
  const unscaled = unscaledInstance(instance);
  const laid = laidMainUnitSize(reader, unscaled, main);
  return {
    width: laid.width === unscaled.width ? instance.width : laid.width * scale,
    height: laid.height === unscaled.height ? instance.height : laid.height * scale,
  };
}

/**
 * An instance as its content is laid out: its box divided by its `scale`, in its main's
 * units. An unscaled instance is returned as it is.
 *
 * @param instance - An instance.
 * @returns The instance with its box in main units.
 */
export function unscaledInstance(instance: InstanceObject): InstanceObject {
  const scale = instance.scale ?? 1;
  return scale === 1
    ? instance
    : { ...instance, width: instance.width / scale, height: instance.height / scale };
}

/**
 * {@link laidInstanceSize} in main units, for an instance whose box is already in them.
 *
 * @param reader - The board.
 * @param instance - The instance, its box in main units.
 * @param main - Its main.
 * @returns Its width and height in main units.
 */
function laidMainUnitSize(
  reader: LayoutReader,
  instance: InstanceObject,
  main: BoardObject,
): BoxSize {
  if (main.type !== 'component') return { width: instance.width, height: instance.height };
  const records = effectiveOverrides(instance, main);
  // The variant's own size. On an axis the instance hasn't fixed, an explicit root size
  // is the variant's box, laid out as fixed even on a hug axis; on an axis other presets size and
  // this variant doesn't, the main's own, or its laid content on a hug axis.
  const root = recordAt(records, main.id);
  const sized = variantSizedAxes(main);
  const rootWidth = instance.isWidthFixed === true ? undefined : root?.width;
  const rootHeight = instance.isHeightFixed === true ? undefined : root?.height;
  const own = {
    width:
      rootWidth ??
      (sized.isWidthSized && instance.isWidthFixed !== true ? main.width : instance.width),
    height:
      rootHeight ??
      (sized.isHeightSized && instance.isHeightFixed !== true ? main.height : instance.height),
  };
  // The main as the records draw it: children at their records' sizes, layout patched.
  const drawnReader: LayoutReader = {
    get: (id) => drawnObject(reader.get(id), records, main.id),
    childrenOf: (id) => reader.childrenOf(id),
  };
  const drawnMain = drawnObject(main, records, main.id) ?? main;
  const layout = autoLayoutOf(drawnMain);
  if (layout === undefined) return own;
  const variantLayout: AutoLayout = {
    ...layout,
    ...(rootWidth === undefined ? {} : { width: 'fixed' }),
    ...(rootHeight === undefined ? {} : { height: 'fixed' }),
  };
  const tree = autoLayoutTree(
    drawnReader,
    { ...drawnMain, ...own, autoLayout: variantLayout } as BoardObject,
    records,
  );
  const laid =
    tree === undefined ? undefined : layOutStack(tree).find(({ key }) => key === main.id);
  if (laid === undefined) return own;
  return {
    width: variantLayout.width === 'hug' && instance.isWidthFixed !== true ? laid.width : own.width,
    height:
      variantLayout.height === 'hug' && instance.isHeightFixed !== true ? laid.height : own.height,
  };
}

/**
 * Lays out an instance's expanded content: every outermost auto-layout container in it,
 * the main itself or a frame or main inside, is laid out with the instance's records, so a hidden
 * child leaves the flow and an overridden text takes its measured size, and its siblings move. The
 * main as the root keeps the instance's box. Children of an auto-layout container ignore their
 * constraints (decision 6): they start from their own size, not the one `constrainChildren`
 * mapped. A box the layout resizes that has children of its own and no auto-layout maps them to
 * its new size with `constrainChildren`. Returns new maps; mutates neither input.
 *
 * @param board - The source board.
 * @param children - The board's child index.
 * @param main - The main being expanded.
 * @param instance - The instance, with its effective overrides.
 * @param content - The main's definition content, parents before children.
 * @param mapped - The content as `constrainChildren` placed it in the instance's size.
 * @returns The content's placed objects, by id.
 */
export function layOutInstanceContent(
  board: Board,
  children: ChildIndex,
  main: BoardObject,
  instance: InstanceObject,
  content: readonly BoardObject[],
  mapped: ReadonlyMap<ObjectId, BoardObject>,
): Map<ObjectId, BoardObject> {
  const placed = new Map(mapped);
  const roots = [main, ...content].filter((object) => {
    if (autoLayoutOf(object) === undefined) return false;
    if (object.id === main.id) return true;
    const parent = object.parentId === null ? undefined : board.objects.get(object.parentId);
    return autoLayoutOf(parent) === undefined;
  });
  if (roots.length === 0) return placed;
  const reader: LayoutReader = {
    get: (id) => board.objects.get(id),
    childrenOf: (id) => children.get(id) ?? [],
  };
  for (const root of roots) {
    // The root is where the instance put it: the main is the instance's own box, and a frame
    // inside a main without auto-layout is where `constrainChildren` mapped it.
    const box =
      root.id === main.id
        ? { ...root, width: instance.width, height: instance.height }
        : (placed.get(root.id) ?? root);
    const tree = autoLayoutTree(reader, box, instance.overrides);
    if (tree === undefined) continue;
    for (const placement of layOutStack(tree)) {
      const id = placement.key as ObjectId;
      const isRoot = id === root.id;
      if (isRoot && root.id === main.id) continue;
      const source = board.objects.get(id);
      if (source === undefined || !isBox(source)) continue;
      const current = placed.get(id);
      const from = current !== undefined && isBox(current) ? current : source;
      const x = isRoot ? from.x : placement.x;
      const y = isRoot ? from.y : placement.y;
      const { width, height } = placement;
      if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) continue;
      placed.set(id, { ...from, x, y, width, height });
      if (
        autoLayoutOf(source) === undefined &&
        (width !== source.width || height !== source.height)
      ) {
        for (const object of constrainChildren(board, source, { width, height }, children)) {
          placed.set(object.id, object);
        }
      }
    }
  }
  return placed;
}
