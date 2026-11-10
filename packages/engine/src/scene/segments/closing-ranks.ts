import type { ObjectId } from '@canvas/schema';

import type { ScenePass } from '../scene-pass.js';
import type { Scene } from '../scene.js';

import { RankIndex } from './rank-index.js';
import type { ZOrderMirror } from './z-order-mirror.js';

// Closing paint ranks: a pass drawn after its objects' descendants
// (`ScenePass.isDrawnAfterDescendants`, a frame's outline) draws them at a second rank right after
// the object's subtree (`paintRanksOfSiblings`). These are the tables the z-order segments derive
// from such a paint order. Pure.

/**
 * Each object's own paint rank, and each closing rank by its object: live indexes the z-order
 * segments keep current through edits of the order (`RankIndex`).
 */
export interface RanksByObject {
  /** Every object's own rank. */
  readonly rankById: RankIndex;
  /** The closing rank of each object that has one. */
  readonly closingRankById: RankIndex;
}

/**
 * Indexes a paint order by object: own ranks and closing ranks apart.
 *
 * @param paintOrder - Per rank, its object (an object with a closing rank appears twice).
 * @param isClosingRank - Per rank, 1 where it is a closing rank.
 * @returns The two indexes.
 */
export function ranksByObject(
  paintOrder: readonly ObjectId[],
  isClosingRank: Uint8Array,
): RanksByObject {
  const rankById = new RankIndex();
  const closingRankById = new RankIndex();
  paintOrder.forEach((id, rank) => {
    (isClosingRank[rank] === 1 ? closingRankById : rankById).set(id, rank);
  });
  return { rankById, closingRankById };
}

/**
 * Each rank's occluder flag: an object's own rank takes the flags of its passes but those drawn
 * after descendants, and its closing rank theirs.
 *
 * @param paintOrder - Per rank, its object.
 * @param isClosingRank - Per rank, 1 where it is a closing rank.
 * @param mirror - The objects and their flags.
 * @param passes - The scene's passes.
 * @returns Per rank, 1 for an occluder.
 */
export function occludersByRank(
  paintOrder: readonly ObjectId[],
  isClosingRank: Uint8Array,
  mirror: Pick<ZOrderMirror, 'get' | 'isOccluder'>,
  passes: readonly ScenePass[],
): Uint8Array<ArrayBuffer> {
  const own = passes.filter((pass) => pass.isDrawnAfterDescendants !== true);
  const after = passes.filter((pass) => pass.isDrawnAfterDescendants === true);
  return Uint8Array.from(paintOrder, (id, rank) => {
    const object = mirror.get(id);
    return object && mirror.isOccluder(object, isClosingRank[rank] === 1 ? after : own) ? 1 : 0;
  });
}

/**
 * Whether a rank holds a pass's records of its object: a closing rank only those of passes
 * drawn after descendants, an object's own rank only the others' when it has a closing rank
 * (every pass's otherwise).
 *
 * @param passes - The scene's passes.
 * @param isClosingRank - Per rank, 1 where it is a closing rank.
 * @param closingRankById - The closing rank of each object that has one.
 * @returns The test, by rank, object and pass name.
 */
export function rankHoldsPass(
  passes: readonly ScenePass[],
  isClosingRank: Uint8Array,
  closingRankById: ReadonlyMap<ObjectId, number>,
): (rank: number, id: ObjectId, passName: string) => boolean {
  const afterNames = new Set(
    passes.filter((pass) => pass.isDrawnAfterDescendants === true).map(({ name }) => name),
  );
  return (rank, id, passName) => {
    const isClosing = isClosingRank[rank] === 1;
    if (isClosing) return afterNames.has(passName);
    return !afterNames.has(passName) || !closingRankById.has(id);
  };
}

/**
 * The ranks a pass's records of each object take: the closing ranks for a pass drawn after
 * descendants, the objects' own ranks otherwise.
 *
 * @param pass - The pass.
 * @param pass.isDrawnAfterDescendants - Whether it is drawn after descendants.
 * @param rankById - Every object's own rank.
 * @param closingRankById - The closing rank of each object that has one.
 * @returns The ranks the pass's records take, by object.
 */
export function ranksOfPass(
  { isDrawnAfterDescendants }: { readonly isDrawnAfterDescendants?: boolean | undefined },
  rankById: ReadonlyMap<ObjectId, number>,
  closingRankById: ReadonlyMap<ObjectId, number>,
): ReadonlyMap<ObjectId, number> {
  return isDrawnAfterDescendants === true ? closingRankById : rankById;
}

/**
 * A rank's records in a pass, for the segment windows (`SegmentWindows`): the slots of the
 * rank's object, when the rank holds that pass's records (`rankHoldsPass`); none otherwise.
 *
 * @param scene - The scene's passes and its slot lookup (`Scene.slotsOf`).
 * @param paintOrder - Per rank, its object.
 * @param isClosingRank - Per rank, 1 where it is a closing rank.
 * @param closingRankById - The closing rank of each object that has one.
 * @returns The lookup, by rank and pass name.
 */
export function slotsOfRank(
  scene: Pick<Scene, 'passes' | 'slotsOf'>,
  paintOrder: readonly ObjectId[],
  isClosingRank: Uint8Array,
  closingRankById: ReadonlyMap<ObjectId, number>,
): (rank: number, passName: string) => readonly number[] {
  const holds = rankHoldsPass(scene.passes, isClosingRank, closingRankById);
  return (rank, passName) => {
    const id = paintOrder[rank];
    return id === undefined || !holds(rank, id, passName) ? [] : scene.slotsOf(id, passName);
  };
}
