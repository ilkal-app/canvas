// Stack layout (moved here for live auto-layout in): a container stacks its
// children in a row or a column, with a gap between them and padding inside, aligned on the
// cross axis, justified on the main axis, some of them filling it, hidden ones left out, and the
// container hugging its content or keeping its size, as Figma's auto layout does. MCP's
// `create_objects` lays out once with it; a frame's or main's `autoLayout` (`stackLayoutOf`)
// is laid out with it whenever its children change. Pure: inputs are not mutated.

import type { AutoLayout } from '../fields/auto-layout.js';

/** The axis children are stacked along. */
export type StackDirection = 'row' | 'column';

/** Where children sit on the cross axis: at its start, centred, at its end, or stretched across. */
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

/** How free main-axis space is shared out: packed at the start, centred, at the end, or spread. */
export type StackJustify = 'start' | 'center' | 'end' | 'space-between';

/** Space inside a container's edges, world units. */
export interface StackPadding {
  /** Above the first row or the children. */
  readonly top: number;
  /** Right of the children. */
  readonly right: number;
  /** Below the children. */
  readonly bottom: number;
  /** Left of the children. */
  readonly left: number;
}

/** How a container lays its children out. */
export interface StackLayout {
  /** The main axis. */
  readonly direction: StackDirection;
  /**
   * Space between neighbouring children on the main axis, world units; negative overlaps them.
   * Ignored when they are spread (`space-between` in a container of its own size).
   */
  readonly gap: number;
  /** Space inside the container's edges. */
  readonly padding: StackPadding;
  /** Where children sit on the cross axis. */
  readonly align: StackAlign;
  /**
   * How positive free main-axis space is shared out when the container keeps its main size and
   * no child fills; `start` when absent. With one child `space-between` is `start`.
   */
  readonly justify?: StackJustify | undefined;
  /** Whether the container's width is its content's (true) or its own (false). */
  readonly isHuggingWidth: boolean;
  /** Whether the container's height is its content's (true) or its own (false). */
  readonly isHuggingHeight: boolean;
}

/** One object in a layout tree: its own size, and for a container its layout and children. */
export interface StackNode {
  /** The object's key, as the caller names it. */
  readonly key: string;
  /** The object's own width, world units: used unless the layout sizes it. */
  readonly width: number;
  /** The object's own height, world units: used unless the layout sizes it. */
  readonly height: number;
  /**
   * For an object whose height follows its width (text that wraps, a sticky note): its height
   * at a width the layout gives it.
   */
  readonly heightForWidth?: (width: number) => number;
  /** Whether it takes the main axis space its container has left, shared with other fillers. */
  readonly isFilling?: boolean;
  /** Whether it is hidden: not laid out, not placed, and taking no space or gap. */
  readonly isHidden?: true;
  /** The container's layout; absent for an object laid out as a box. */
  readonly layout?: StackLayout;
  /** The container's children, in stacking order. */
  readonly children?: readonly StackNode[];
}

/** Where the layout put an object, in its parent's frame, and its size. */
export interface StackPlacement {
  /** The object's key. */
  readonly key: string;
  /** Left, in the parent's frame (the root keeps 0). */
  readonly x: number;
  /** Top, in the parent's frame (the root keeps 0). */
  readonly y: number;
  /** Width, world units. */
  readonly width: number;
  /** Height, world units. */
  readonly height: number;
}

/** A size the parent imposes on one axis or both. */
interface Assigned {
  readonly width?: number;
  readonly height?: number;
}

/** A node sized and with its children placed, before its own position is known. */
interface Sized {
  readonly node: StackNode;
  readonly width: number;
  readonly height: number;
  readonly children: readonly { readonly x: number; readonly y: number; readonly child: Sized }[];
}

const mainOf = (direction: StackDirection, size: { width: number; height: number }): number =>
  direction === 'row' ? size.width : size.height;
const crossOf = (direction: StackDirection, size: { width: number; height: number }): number =>
  direction === 'row' ? size.height : size.width;

/**
 * An assignment on one axis of a direction.
 *
 * @param direction - The container's direction.
 * @param main - The main-axis size, if imposed.
 * @param cross - The cross-axis size, if imposed.
 * @returns The width and height imposed.
 */
function assignment(direction: StackDirection, main?: number, cross?: number): Assigned {
  const [width, height] = direction === 'row' ? [main, cross] : [cross, main];
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

/**
 * Sizes a leaf: the size imposed, else its own; a height that follows the width is measured at
 * the width it ends up with, when that width was imposed.
 *
 * @param node - The leaf.
 * @param assigned - What the parent imposes.
 * @returns The sized leaf.
 */
function sizeLeaf(node: StackNode, assigned: Assigned): Sized {
  const width = assigned.width ?? node.width;
  const height =
    assigned.height ??
    (assigned.width !== undefined && node.heightForWidth !== undefined
      ? node.heightForWidth(width)
      : node.height);
  return { node, width, height, children: [] };
}

/**
 * Sizes a node and places its children: a leaf as {@link sizeLeaf}; a container by its layout.
 *
 * @param node - The node.
 * @param assigned - What its parent imposes.
 * @returns The sized node.
 */
function size(node: StackNode, assigned: Assigned): Sized {
  const { layout } = node;
  if (layout === undefined) return sizeLeaf(node, assigned);
  const { direction, padding, align } = layout;
  const justify = layout.justify ?? 'start';
  const children = (node.children ?? []).filter((child) => child.isHidden !== true);
  const ownWidth = assigned.width ?? (layout.isHuggingWidth ? undefined : node.width);
  const ownHeight = assigned.height ?? (layout.isHuggingHeight ? undefined : node.height);
  const hasFiller = children.some((child) => child.isFilling === true);
  // Spread with equal gaps, the stored gap does not apply (as Figma's "auto" gap): the
  // children meet edge to edge when they do not fit, rather than overlap or part by it.
  const isSpread =
    justify === 'space-between' &&
    !hasFiller &&
    (direction === 'row' ? ownWidth : ownHeight) !== undefined;
  const gap = isSpread ? 0 : layout.gap;
  const [padMainStart, padMainEnd, padCrossStart, padCrossEnd] =
    direction === 'row'
      ? [padding.left, padding.right, padding.top, padding.bottom]
      : [padding.top, padding.bottom, padding.left, padding.right];
  const ownMain = direction === 'row' ? ownWidth : ownHeight;
  const ownCross = direction === 'row' ? ownHeight : ownWidth;
  const gaps = gap * Math.max(0, children.length - 1);
  let innerCross =
    ownCross === undefined ? undefined : Math.max(0, ownCross - padCrossStart - padCrossEnd);

  const sizeAll = (cross: number | undefined, fillMain: number | undefined): Sized[] =>
    children.map((child) => {
      const childCross = align === 'stretch' ? cross : undefined;
      const childMain = child.isFilling === true ? fillMain : undefined;
      return size(child, assignment(direction, childMain, childCross));
    });

  const fillMainOf = (sized: readonly Sized[]): number | undefined => {
    const fillers = children.filter((child) => child.isFilling === true).length;
    if (ownMain === undefined || fillers === 0) return undefined;
    const fixed = sized
      .filter((child) => child.node.isFilling !== true)
      .reduce((total, child) => total + mainOf(direction, child), 0);
    const free = ownMain - padMainStart - padMainEnd - gaps - fixed;
    return Math.max(0, free / fillers);
  };

  let sized = sizeAll(innerCross, undefined);
  const fillMain = fillMainOf(sized);
  if (fillMain !== undefined) sized = sizeAll(innerCross, fillMain);
  if (innerCross === undefined) {
    innerCross = sized.reduce((widest, child) => Math.max(widest, crossOf(direction, child)), 0);
    if (align === 'stretch') sized = sizeAll(innerCross, fillMain);
  }
  const crossSpace = innerCross;

  // A negative gap overlaps the children; the content never measures below nothing, so
  // a hugging container is never smaller than its padding.
  const content = Math.max(
    0,
    sized.reduce((total, child) => total + mainOf(direction, child), 0) + gaps,
  );
  const free =
    ownMain === undefined || fillMain !== undefined
      ? 0
      : Math.max(0, ownMain - padMainStart - padMainEnd - content);
  const between = justify === 'space-between' && sized.length > 1 ? free / (sized.length - 1) : 0;
  const lead = justify === 'center' ? free / 2 : justify === 'end' ? free : 0;
  let cursor = padMainStart + lead;
  const placed = sized.map((child) => {
    const childCross = crossOf(direction, child);
    const free = crossSpace - childCross;
    const offset = align === 'center' ? free / 2 : align === 'end' ? free : 0;
    const main = cursor;
    cursor += mainOf(direction, child) + gap + between;
    const cross = padCrossStart + offset;
    return direction === 'row' ? { x: main, y: cross, child } : { x: cross, y: main, child };
  });
  const contentMain = padMainStart + content + padMainEnd;
  const main = ownMain ?? contentMain;
  const cross = ownCross ?? crossSpace + padCrossStart + padCrossEnd;
  const [width, height] = direction === 'row' ? [main, cross] : [cross, main];
  return { node, width, height, children: placed };
}

/**
 * Lays a container tree out: sizes every object the layout sizes, places every child of a
 * container in its parent's frame, and lists them, the root first, then depth first. The root
 * keeps position (0, 0); its caller positions it. Pure.
 *
 * @param root - The root container (or a box, laid out as itself).
 * @returns Each object's position in its parent's frame and its size.
 */
export function layOutStack(root: StackNode): StackPlacement[] {
  const placements: StackPlacement[] = [];
  const visit = (sized: Sized, x: number, y: number): void => {
    placements.push({ key: sized.node.key, x, y, width: sized.width, height: sized.height });
    for (const placed of sized.children) visit(placed.child, placed.x, placed.y);
  };
  visit(size(root, {}), 0, 0);
  return placements;
}

/**
 * The stack layout of a frame's or main's stored auto-layout: the same fields, with
 * hugging read from each axis's sizing.
 *
 * @param autoLayout - The stored auto-layout.
 * @returns Its stack layout.
 */
export function stackLayoutOf(autoLayout: AutoLayout): StackLayout {
  return {
    direction: autoLayout.direction,
    gap: autoLayout.gap,
    padding: autoLayout.padding,
    align: autoLayout.align,
    justify: autoLayout.justify,
    isHuggingWidth: autoLayout.width === 'hug',
    isHuggingHeight: autoLayout.height === 'hug',
  };
}
