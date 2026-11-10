import type { BoardReader } from '@canvas/document';
import {
  slotSwapIssue,
  type BoardObject,
  type InstanceObject,
  type ObjectId,
} from '@canvas/schema';

import type { ComponentListItem } from './components/component-list.js';
import { closureBoard, type SlotPlacement } from './instance-override-rows.js';

/** The most mains a slot's swap options may list (`setSwapOptions`). */
export const MAX_SWAP_OPTIONS = 64;

/** One main a slot may show, as a picker lists it. */
export interface SwapChoice {
  /** The main. */
  readonly id: ObjectId;
  /** Its name. */
  readonly name: string;
}

/**
 * The live mains among `mains` that can expand in a slot under `ancestorMains` by the schema's
 * read rule (`slotSwapIssue`: no cycle, within the depth limit), in the list's order.
 *
 * @param board - The whole board.
 * @param mains - The candidates, the board's live mains in the components panel's order.
 * @param ancestorMains - The mains expanded above the slot, outermost first.
 * @returns The candidates that can expand there.
 */
function expandable(
  board: BoardReader,
  mains: readonly ComponentListItem[],
  ancestorMains: readonly ObjectId[],
): ComponentListItem[] {
  const closure = closureBoard(
    board,
    mains.map(({ id }) => id),
  );
  return mains.filter(
    ({ id }) => slotSwapIssue(closure.board, id, ancestorMains, closure.children) === undefined,
  );
}

/**
 * The name a picker gives a slot's stored main: the components panel's, else the board's (a
 * retired main), else "Main not found".
 *
 * @param board - The whole board.
 * @param mains - The board's live mains.
 * @param id - The stored main.
 * @returns The name.
 */
function storedMainName(
  board: BoardReader,
  mains: readonly ComponentListItem[],
  id: ObjectId,
): string {
  const listed = mains.find((item) => item.id === id);
  if (listed !== undefined) return listed.name;
  const main = board.get(id);
  return main?.type === 'component' ? main.name : 'Main not found';
}

/**
 * The mains a slot row's Main picker offers: the slot's stored main first, always
 * (choosing it clears the swap), then the live mains the slot's `swapOptions` list, or every live
 * main when it lists none, that can expand there (`slotSwapIssue`'s read rule), in the
 * components panel's order; the main it shows now is offered even outside its options, as a swap
 * stored before the options were narrowed is kept. Pure.
 *
 * @param board - The whole board.
 * @param placement - The slot (its `mainId` the main it shows), its stored main and the mains
 *   above it (`InstanceOverrideRow.slot`).
 * @param mains - The board's live mains (`componentListOf`).
 * @returns The choices.
 */
export function slotSwapChoices(
  board: BoardReader,
  placement: SlotPlacement,
  mains: readonly ComponentListItem[],
): SwapChoice[] {
  const { instance: slot, storedMainId, ancestorMains } = placement;
  const allowed = slot.swapOptions === undefined ? undefined : new Set(slot.swapOptions);
  const candidates = mains.filter(
    ({ id }) => id !== storedMainId && (id === slot.mainId || allowed?.has(id) !== false),
  );
  const offered = expandable(board, candidates, ancestorMains);
  const stored = { id: storedMainId, name: storedMainName(board, mains, storedMainId) };
  return [stored, ...offered.map(({ id, name }) => ({ id, name }))];
}

/**
 * The mains that contain an object, through its parents, outermost first. A parent cycle, which
 * only a damaged board holds, ends the walk.
 *
 * @param board - The whole board.
 * @param object - The object.
 * @returns The containing mains' ids.
 */
export function containingMainsOf(board: BoardReader, object: BoardObject): ObjectId[] {
  const mains: ObjectId[] = [];
  const seen = new Set<ObjectId>();
  for (let parent = object.parentId; parent !== null && !seen.has(parent);) {
    seen.add(parent);
    const container = board.get(parent);
    if (container?.type === 'component') mains.unshift(container.id);
    parent = container?.parentId ?? null;
  }
  return mains;
}

/**
 * The mains a slot's Swap options group lists: the live mains that can expand in the
 * slot where it sits in its mains (`slotSwapIssue`'s read rule), and any its options already list,
 * in the components panel's order. Pure.
 *
 * @param board - The whole board.
 * @param slot - The slot, an instance inside a main.
 * @param containing - The mains containing it, outermost first (`containingMainsOf`).
 * @param mains - The board's live mains (`componentListOf`).
 * @returns The choices.
 */
export function swapOptionChoices(
  board: BoardReader,
  slot: InstanceObject,
  containing: readonly ObjectId[],
  mains: readonly ComponentListItem[],
): SwapChoice[] {
  const listed = new Set(slot.swapOptions);
  const offered = new Set(expandable(board, mains, containing).map(({ id }) => id));
  return mains
    .filter(({ id }) => listed.has(id) || offered.has(id))
    .map(({ id, name }) => ({ id, name }));
}
