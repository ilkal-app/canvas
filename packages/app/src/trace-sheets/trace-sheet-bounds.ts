import type { DocumentStore } from '@canvas/document';
import {
  worldBoundsOf,
  worldTransformOf,
  type TraceTintModel,
  type WorldBounds,
} from '@canvas/engine';
import type { ObjectId, Rgba } from '@canvas/schema';

import type { TraceSheet } from './trace-sheet-tracker.js';

/**
 * The smallest bounds holding both.
 *
 * @param first - Bounds, world units.
 * @param second - Other bounds.
 * @returns Their union.
 */
function union(first: WorldBounds, second: WorldBounds): WorldBounds {
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

/** What the bounds read of the board. */
export type TraceSheetBoard = Pick<DocumentStore, 'get'>;

/**
 * The union of the world bounds of a sheet's objects on the board (`worldBoundsOf` through
 * `worldTransformOf`, as the engine indexes them): what the tint covers and where the sheet's
 * tab sits. Objects with no geometry of their own (a group, a comment) add nothing. Pure.
 *
 * @param board - The board.
 * @param memberIds - The sheet's objects.
 * @returns The bounds, world units, or undefined when none of them has any.
 */
export function sheetBoundsOf(
  board: TraceSheetBoard,
  memberIds: readonly ObjectId[],
): WorldBounds | undefined {
  const source = { get: (id: ObjectId) => board.get(id) };
  let all: WorldBounds | undefined;
  for (const id of memberIds) {
    const object = board.get(id);
    if (object === undefined) continue;
    const bounds = worldBoundsOf(object, worldTransformOf(object, source));
    if (bounds !== undefined) all = all === undefined ? bounds : union(all, bounds);
  }
  return all;
}

/** A sheet as the shell shows it: the sheet and the bounds of its objects. */
export interface PlacedTraceSheet extends TraceSheet {
  /** The union of its objects' world bounds. */
  readonly bounds: WorldBounds;
}

/**
 * Places each sheet on the board ({@link sheetBoundsOf}), leaving out a sheet none of whose
 * objects has bounds. Pure.
 *
 * @param board - The board.
 * @param sheets - The open sheets.
 * @returns The placed sheets, in order.
 */
export function placeSheets(
  board: TraceSheetBoard,
  sheets: readonly TraceSheet[],
): PlacedTraceSheet[] {
  return sheets.flatMap((sheet) => {
    const bounds = sheetBoundsOf(board, sheet.memberIds);
    return bounds === undefined ? [] : [{ ...sheet, bounds }];
  });
}

/**
 * The engine's trace tint for the placed sheets, all in the agent colour (`--color-hand-agent`
 * of the theme). Pure.
 *
 * @param sheets - The placed sheets.
 * @param color - The agent colour, straight alpha.
 * @returns The model.
 */
export function traceTintOf(sheets: readonly PlacedTraceSheet[], color: Rgba): TraceTintModel {
  return { sheets: sheets.map(({ bounds }) => ({ bounds, color })) };
}
