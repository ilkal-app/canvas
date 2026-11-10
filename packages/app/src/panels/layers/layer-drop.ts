import type { ObjectId } from '@canvas/schema';

import { isContainerType, type LayerRow } from './layer-rows.js';

// Where a drag over the layers panel, or one of its move keys, puts objects, in the
// terms of the `placeObjects` command: a parent and the child they go directly below (on top of
// the parent's stack when there is none). The rows are listed top first, so "above a row" in the
// list is higher in the stack. Pure: the rows are read, never changed.

/** Where the panel shows a drop: a line between rows, or an outline around a container's row. */
export type LayerDropIndicator =
  | {
      /** A line at the top of the row at `index` (`rows.length` for below the last). */
      readonly kind: 'line';
      /** The row boundary, 0 to `rows.length`. */
      readonly index: number;
      /** The level the objects land at, which indents the line. */
      readonly level: number;
    }
  | {
      /** An outline around the container's row they go into. */
      readonly kind: 'into';
      /** The container's row. */
      readonly index: number;
    };

/** Where objects would go: the command's parent and sibling, and why it is refused, if it is. */
export interface LayerPlacement {
  /** The frame, group or main they end up in, or null for the root. */
  readonly parentId: ObjectId | null;
  /** The child of that parent they go directly below; on top when absent. */
  readonly belowId?: ObjectId;
}

/** A drop at a point of the list: the placement, its indicator and any refusal. */
export interface LayerDrop extends LayerPlacement {
  /** What the panel shows. */
  readonly indicator: LayerDropIndicator;
  /** Why the drop is refused (a locked container, a container among the dragged objects). */
  readonly refusal?: string;
}

/** The share of a container's row, at its top and at its bottom, that drops beside it. */
const EDGE_SHARE = 0.25;

/**
 * Whether a row's object holds children: a frame, a group or a main (`isContainerType`,
 * ruling 14); an instance never does, its content being its main's.
 *
 * @param row - The row.
 * @returns True for frames, groups and mains, empty or not.
 */
function isContainerRow(row: LayerRow): boolean {
  return isContainerType(row.type);
}

/**
 * The index of the nearest row above `index` that is a sibling of the row there (same parent and
 * level) and not dragged, scanning past the siblings' listed descendants.
 *
 * @param rows - The rows.
 * @param index - The row.
 * @param dragged - The dragged objects.
 * @returns Its index, or -1 when it has none.
 */
function siblingAbove(rows: readonly LayerRow[], index: number, dragged: ReadonlySet<ObjectId>) {
  const level = rows[index]?.level ?? 0;
  for (let at = index - 1; at >= 0; at -= 1) {
    const above = rows[at];
    if (above === undefined || above.level < level) return -1;
    if (above.level === level && !dragged.has(above.id)) return at;
  }
  return -1;
}

/**
 * The index of the nearest row below `index` that is a sibling of the row there and not dragged.
 *
 * @param rows - The rows.
 * @param index - The row.
 * @param dragged - The dragged objects.
 * @returns Its index, or -1 when it has none.
 */
function siblingBelow(rows: readonly LayerRow[], index: number, dragged: ReadonlySet<ObjectId>) {
  const level = rows[index]?.level ?? 0;
  for (let at = index + 1; at < rows.length; at += 1) {
    const below = rows[at];
    if (below === undefined || below.level < level) return -1;
    if (below.level === level && !dragged.has(below.id)) return at;
  }
  return -1;
}

/**
 * The index of a row's parent row, scanning up (a parent is listed above its children).
 *
 * @param rows - The rows.
 * @param index - The row.
 * @returns Its index, or -1 at the root.
 */
function parentRowIndex(rows: readonly LayerRow[], index: number): number {
  const parentId = rows[index]?.parentId ?? null;
  if (parentId === null) return -1;
  for (let at = index - 1; at >= 0; at -= 1) if (rows[at]?.id === parentId) return at;
  return -1;
}

/**
 * The placement directly above a row in the list: in its parent, below the sibling above it
 * (dragged siblings skipped), or on top.
 *
 * @param rows - The rows.
 * @param index - The row.
 * @param dragged - The dragged objects.
 * @returns The placement.
 */
function placementAbove(
  rows: readonly LayerRow[],
  index: number,
  dragged: ReadonlySet<ObjectId>,
): LayerPlacement {
  const parentId = rows[index]?.parentId ?? null;
  const above = rows[siblingAbove(rows, index, dragged)];
  return above === undefined ? { parentId } : { parentId, belowId: above.id };
}

/**
 * Why a parent cannot take the dragged objects, if it cannot: it is locked, or it is one of them
 * or inside one (its listed ancestors are scanned up the rows).
 *
 * @param rows - The rows.
 * @param parentIndex - The parent's row, or -1 for the root.
 * @param dragged - The dragged objects.
 * @returns The refusal, or undefined.
 */
function refusalOf(
  rows: readonly LayerRow[],
  parentIndex: number,
  dragged: ReadonlySet<ObjectId>,
): string | undefined {
  const parent = rows[parentIndex];
  if (parent === undefined) return undefined;
  for (let at = parentIndex; at !== -1; at = parentRowIndex(rows, at)) {
    const ancestor = rows[at];
    if (ancestor !== undefined && dragged.has(ancestor.id)) {
      return 'Objects cannot go inside themselves';
    }
  }
  return parent.isLocked ? `“${parent.name}” is locked` : undefined;
}

/**
 * A drop with its refusal, if its parent refuses.
 *
 * @param rows - The rows.
 * @param placement - Where the objects go.
 * @param indicator - What the panel shows.
 * @param parentIndex - The parent's row, or -1 for the root.
 * @param dragged - The dragged objects.
 * @returns The drop.
 */
function dropOf(
  rows: readonly LayerRow[],
  placement: LayerPlacement,
  indicator: LayerDropIndicator,
  parentIndex: number,
  dragged: ReadonlySet<ObjectId>,
): LayerDrop {
  const refusal = refusalOf(rows, parentIndex, dragged);
  return { ...placement, indicator, ...(refusal === undefined ? {} : { refusal }) };
}

/**
 * The drop a drag over the layers list makes at a point: over the top quarter of a
 * frame's or group's row (half of any other row) the objects go directly above that row, as its
 * siblings; over the bottom quarter (half) directly below it, or for an open container with
 * children, on top of its children, where its first child is listed; over the middle of a frame
 * or group, into it, on top. Past the last row they go to the bottom of the root. A container
 * that is locked, or that is one of the dragged objects or inside one, refuses the drop; a point
 * beside a dragged row itself drops nothing. O(rows between the row and its parent or sibling).
 *
 * @param rows - The rows, top first.
 * @param dragged - The dragged objects.
 * @param index - The row under the point; `rows.length` or more past the last row.
 * @param fraction - How far down that row the point is, 0 to 1.
 * @returns The drop, or undefined when there is none.
 */
export function layerDropAt(
  rows: readonly LayerRow[],
  dragged: ReadonlySet<ObjectId>,
  index: number,
  fraction: number,
): LayerDrop | undefined {
  if (index >= rows.length) {
    let bottom: LayerRow | undefined;
    for (let at = rows.length - 1; at >= 0 && bottom === undefined; at -= 1) {
      const row = rows[at];
      if (row?.level === 1 && !dragged.has(row.id)) bottom = row;
    }
    if (bottom === undefined) return undefined;
    const indicator = { kind: 'line', index: rows.length, level: 1 } as const;
    return { parentId: null, belowId: bottom.id, indicator };
  }
  const row = rows[Math.max(0, index)];
  if (row === undefined) return undefined;
  const at = Math.max(0, index);
  const isContainer = isContainerRow(row);
  const edge = isContainer ? EDGE_SHARE : 0.5;
  const parentIndex = parentRowIndex(rows, at);
  // Only a container takes objects into it: the exact middle of a leaf (an instance among them)
  // falls below it.
  if (isContainer && fraction >= edge && fraction <= 1 - edge) {
    const indicator = { kind: 'into', index: at } as const;
    return dropOf(rows, { parentId: row.id }, indicator, at, dragged);
  }
  if (dragged.has(row.id)) return undefined;
  if (fraction < edge) {
    const indicator = { kind: 'line', index: at, level: row.level } as const;
    return dropOf(rows, placementAbove(rows, at, dragged), indicator, parentIndex, dragged);
  }
  if (row.isExpanded) {
    const indicator = { kind: 'line', index: at + 1, level: row.level + 1 } as const;
    return dropOf(rows, { parentId: row.id }, indicator, at, dragged);
  }
  const indicator = { kind: 'line', index: at + 1, level: row.level } as const;
  const placement = { parentId: row.parentId, belowId: row.id };
  return dropOf(rows, placement, indicator, parentIndex, dragged);
}

/**
 * Where a move key of the layers tree puts the focused row's objects (the keyboard
 * alternative to dragging; the panel takes them with Alt): Up above the sibling above, Down
 * below the sibling below, Left out of the parent to just above it, Right into the frame or
 * group listed directly above, on top of its children. Dragged siblings (the other objects
 * moving) are skipped. The command refuses what the target cannot take (a locked container).
 *
 * @param rows - The rows, top first.
 * @param index - The focused row.
 * @param key - `KeyboardEvent.key`.
 * @param moving - The objects that move.
 * @returns The placement, or undefined when the key moves nothing.
 */
export function layerKeyPlacement(
  rows: readonly LayerRow[],
  index: number,
  key: string,
  moving: ReadonlySet<ObjectId>,
): LayerPlacement | undefined {
  const row = rows[index];
  if (row === undefined) return undefined;
  switch (key) {
    case 'ArrowUp': {
      const above = siblingAbove(rows, index, moving);
      return above === -1 ? undefined : placementAbove(rows, above, moving);
    }
    case 'ArrowDown': {
      const below = rows[siblingBelow(rows, index, moving)];
      return below === undefined ? undefined : { parentId: row.parentId, belowId: below.id };
    }
    case 'ArrowLeft': {
      const parent = parentRowIndex(rows, index);
      return parent === -1 ? undefined : placementAbove(rows, parent, moving);
    }
    case 'ArrowRight': {
      const above = rows[siblingAbove(rows, index, moving)];
      return above !== undefined && isContainerRow(above) ? { parentId: above.id } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The objects a drag or a move key takes: those listed, less any whose ancestor is listed too
 * (it moves with that ancestor). O(objects × depth).
 *
 * @param ids - The objects, primary first.
 * @param parentOf - An object's parent, null at the root, undefined when it cannot be read.
 * @returns The objects, in the order given.
 */
export function movableLayerIds(
  ids: readonly ObjectId[],
  parentOf: (id: ObjectId) => ObjectId | null | undefined,
): ObjectId[] {
  const listed = new Set(ids);
  return ids.filter((id) => {
    const walked = new Set<ObjectId>([id]);
    for (
      let parent = parentOf(id);
      parent !== null && parent !== undefined;
      parent = parentOf(parent)
    ) {
      if (listed.has(parent)) return false;
      if (walked.has(parent)) return true;
      walked.add(parent);
    }
    return true;
  });
}
