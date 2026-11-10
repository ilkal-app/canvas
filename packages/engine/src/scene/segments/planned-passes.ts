import type { ObjectId } from '@canvas/schema';

import type { Scene } from '../scene.js';

import { ranksOfPass } from './closing-ranks.js';
import type { RankShift } from './order-edits.js';
import type { PlannedPass } from './segment-plan.js';

/** Own and closing ranks by object, as the z-order segments index them. */
export interface RankIndex {
  /** Every object's own rank. */
  readonly rankById: ReadonlyMap<ObjectId, number>;
  /** Each closing rank by its object. */
  readonly closingRankById: ReadonlyMap<ObjectId, number>;
}

/**
 * Per pass, which paint ranks the level of detail hides (the `hidden` form), from the scene's
 * hidden sets: O(objects) per pass with hidden objects. A pass drawn after descendants hides at
 * closing ranks. Pure apart from the reads.
 *
 * @param scene - The scene, for its passes and level of detail.
 * @param rankCount - How many paint ranks there are.
 * @param ranks - Own and closing ranks by object.
 * @returns Per pass, its table, or undefined when it hides nothing.
 */
export function hiddenTablesOf(
  scene: Pick<Scene, 'passes' | 'levelOfDetail'>,
  rankCount: number,
  ranks: RankIndex,
): (Uint8Array | undefined)[] {
  const { levelOfDetail } = scene;
  return scene.passes.map(({ name, isDrawnAfterDescendants }) => {
    const hidden = levelOfDetail.hiddenIn(name);
    if (hidden.size === 0) return undefined;
    const rankById = ranksOfPass(
      { isDrawnAfterDescendants },
      ranks.rankById,
      ranks.closingRankById,
    );
    const table = new Uint8Array(rankCount);
    for (const id of hidden) {
      const rank = rankById.get(id);
      if (rank !== undefined) table[rank] = 1;
    }
    return table;
  });
}

/**
 * The hidden tables after an edit in the middle of the paint order: each hidden rank
 * moved where the edit put it (a removed one dropped), and each inserted object hidden in a pass
 * marked at its new rank (inserted objects have no closing rank, so a pass drawn after
 * descendants marks none). Pure apart from the reads.
 *
 * @param scene - The scene, for its passes and level of detail.
 * @param hiddenByRank - Each pass's hidden table before the edit, in pass order.
 * @param shift - Where the edit moved each rank, and what it inserted.
 * @returns The tables, or undefined when an inserted object is hidden in a pass that hid none
 *   (the caller rebuilds them).
 */
export function shiftedHiddenTables(
  scene: Pick<Scene, 'passes' | 'levelOfDetail'>,
  hiddenByRank: readonly (Uint8Array | undefined)[],
  shift: RankShift,
): (Uint8Array | undefined)[] | undefined {
  const tables: (Uint8Array | undefined)[] = [];
  for (const [index, { name, isDrawnAfterDescendants }] of scene.passes.entries()) {
    const hidden = scene.levelOfDetail.hiddenIn(name);
    const insertedHidden =
      isDrawnAfterDescendants === true ? [] : shift.inserted.filter(([id]) => hidden.has(id));
    const table = hiddenByRank[index];
    if (table === undefined) {
      if (insertedHidden.length > 0) return undefined;
      tables.push(undefined);
      continue;
    }
    const next = new Uint8Array(shift.length);
    // Ranks below the first the edit moved keep their numbers.
    next.set(table.subarray(0, Math.min(shift.firstMoved, table.length, shift.length)));
    for (let rank = shift.firstMoved; rank < table.length; rank += 1) {
      if (table[rank] !== 1) continue;
      const moved = shift.newRanks[rank] ?? -1;
      if (moved >= 0) next[moved] = 1;
    }
    for (const [, rank] of insertedHidden) next[rank] = 1;
    tables.push(next);
  }
  return tables;
}

/**
 * The passes as the planner takes them: each with its slot owners, its page table (a paged pass;
 * images keep paint order across pages, text draws page by page) and its hidden table.
 *
 * @param scene - The scene, for its passes and page tables.
 * @param slotOwners - Each pass's slot owners, in pass order.
 * @param hiddenByRank - Each pass's hidden table, in pass order.
 * @returns The planned passes.
 */
export function plannedPassesOf(
  scene: Pick<Scene, 'passes' | 'pagesOf'>,
  slotOwners: readonly PlannedPass[],
  hiddenByRank: readonly (Uint8Array | undefined)[],
): PlannedPass[] {
  return slotOwners.map((pass, index) => {
    const pageOfSlot = scene.pagesOf(pass.name);
    const isHiddenByRank = hiddenByRank[index];
    const isPaintOrderedAcrossPages =
      scene.passes.find(({ name }) => name === pass.name)?.isPaintOrderedAcrossPages === true;
    return {
      ...pass,
      ...(pageOfSlot === undefined ? {} : { pageOfSlot, isPaintOrderedAcrossPages }),
      ...(isHiddenByRank === undefined ? {} : { isHiddenByRank }),
    };
  });
}
