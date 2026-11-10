import { isFarObject } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { transformableIds, type SelectionSource } from './selection-geometry.js';
import { isLeftOutOfTransforms } from './transform-exclusion.js';

/**
 * The selection as a transform sees it: which selected objects are far
 * (`isFarObject`: a box on the board past the bound, or not computable, their own or a
 * descendant's), and which a transform changes. Worked out once per selection and kept until a
 * change set touches the selection (`SelectionFrameCache`), so a drag does not test every pointer
 * move again; the frame the handles sit on, the pivot, the origin and the command all come from
 * the same near set.
 */
export interface SelectionScope {
  /** The selected objects that are far, whatever else they are. */
  readonly far: ReadonlySet<ObjectId>;
  /**
   * The objects a transform changes: `transformableIds` (no locked object, none whose ancestor
   * is selected too, no group holding a locked object) without those `isLeftOutOfTransforms`
   * names (far ones, and ones the engine does not draw), in selection order.
   */
  readonly near: readonly ObjectId[];
  /**
   * The objects a transform would change but skips, in selection order: every one
   * `isLeftOutOfTransforms` names, far or not drawn, so the one notice counts them all.
   */
  readonly skipped: readonly ObjectId[];
}

/**
 * Works out the scope of a selection. Pure; O(the selection and its subtrees).
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @param knownFar - Cached far objects for this selection, when already checked.
 * @returns The scope.
 */
export function selectionScopeOf(
  ids: readonly ObjectId[],
  source: SelectionSource,
  knownFar?: ReadonlySet<ObjectId>,
): SelectionScope {
  const far = knownFar ?? new Set(ids.filter((id) => isFarObject(source, id)));
  const movable = transformableIds(ids, source);
  const near: ObjectId[] = [];
  const skipped: ObjectId[] = [];
  for (const id of movable) {
    (isLeftOutOfTransforms(id, source, far) ? skipped : near).push(id);
  }
  return { far, near, skipped };
}

/**
 * The selected objects a transform (a move, nudge, resize or rotation, an arrangement) changes,
 * the one helper every transform takes its ids from: `transformableIds` without those
 * `isLeftOutOfTransforms` names, the far ones (`isFarObject`) and the ones the engine does
 * not draw (`SelectionSource.isDrawable`). Delete does not use it: both kinds can always
 * be deleted. Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The ids to transform, in selection order.
 */
export function nearIds(ids: readonly ObjectId[], source: SelectionSource): ObjectId[] {
  return [...selectionScopeOf(ids, source).near];
}

/**
 * The selected objects a transform would change but skips, for the caller to say so: the far ones
 * and, with a hit gate, the ones the engine does not draw (
 * `isLeftOutOfTransforms`). Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The skipped ids among the transformable ones, in selection order.
 */
export function farIds(ids: readonly ObjectId[], source: SelectionSource): ObjectId[] {
  return [...selectionScopeOf(ids, source).skipped];
}

/** What a transform left out because the objects are far or not drawn (`farSkipOf`). */
export interface FarSkip {
  /** The objects skipped, in selection order; at least one. */
  readonly ids: readonly ObjectId[];
  /** Whether every object the transform would have changed was skipped, so it did nothing. */
  readonly isEvery: boolean;
}

/**
 * What a transform of a selection leaves out because the objects are far or not drawn,
 * for the shell to say so in one notice.
 *
 * @param scope - The selection's scope (`selectionScopeOf`).
 * @returns The skip, or `undefined` when the transform leaves nothing out.
 */
export function farSkipOfScope(scope: SelectionScope): FarSkip | undefined {
  return scope.skipped.length === 0
    ? undefined
    : { ids: scope.skipped, isEvery: scope.near.length === 0 };
}

/**
 * What a transform of the selection leaves out because the objects are far (`farSkipOfScope` of
 * `selectionScopeOf`).
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @returns The skip, or `undefined` when no selected object the transform would change is far.
 */
export function farSkipOf(ids: readonly ObjectId[], source: SelectionSource): FarSkip | undefined {
  return farSkipOfScope(selectionScopeOf(ids, source));
}
