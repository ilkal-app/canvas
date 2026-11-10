// Position arithmetic and pass followers for a retained move's translations.
import type { ObjectId } from '@canvas/schema';

import type { RetainedMembers } from './retained-members.js';
import type { ScenePassResources } from './scene-pass-resources.js';
import type { SceneObject } from './scene-pass.js';
import type { Scene } from './scene.js';

/** The passes that follow a translating move's targets, and the members with records in them. */
export interface TranslationFollowers {
  readonly passes: readonly ScenePassResources[];
  /** The members, by index in the session's membership. */
  readonly members: readonly number[];
}

/**
 * The passes whose retained targets must follow a translation (`shouldFollowTranslatedTargets`)
 * and the members that have records in any of them, worked out once per session.
 *
 * @param resources - The renderer's passes.
 * @param scene - The scene, for the members' slots.
 * @param ids - The session's members, in order.
 * @returns The followers.
 */
export function followersOf(
  resources: readonly ScenePassResources[],
  scene: Pick<Scene, 'slotsOf'>,
  ids: readonly ObjectId[],
): TranslationFollowers {
  const passes = resources.filter(({ pass }) => pass.shouldFollowTranslatedTargets === true);
  if (passes.length === 0) return { passes, members: [] };
  const members: number[] = [];
  ids.forEach((id, index) => {
    if (passes.some(({ pass }) => scene.slotsOf(id, pass.name).length > 0)) members.push(index);
  });
  return { passes, members };
}

/**
 * Whether two position arrays hold the same values.
 *
 * @param a - One, if any.
 * @param b - The other.
 * @returns True when both have the same length and every value is equal.
 */
export function isSamePositions(a: Float64Array | undefined, b: Float64Array): boolean {
  if (a?.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Positions moved by one translation, as the host mirror places each root
 * (`RetainedMoveMirror.get`): every `x, y` pair plus the delta.
 *
 * @param positions - The positions, `x, y` per root.
 * @param delta - The translation, `[dx, dy]`.
 * @returns A new array.
 */
export function translatedPositions(
  positions: Float64Array,
  delta: readonly [number, number],
): Float64Array {
  const moved = new Float64Array(positions.length);
  for (let index = 0; index < positions.length; index += 2) {
    moved[index] = (positions[index] ?? 0) + delta[0];
    moved[index + 1] = (positions[index + 1] ?? 0) + delta[1];
  }
  return moved;
}

/**
 * Gives the passes that follow translated targets (image residency) their members' targets on a
 * translating frame; the other passes are given them once, when the translation settles.
 *
 * @param followers - The session's followers (`followersOf`).
 * @param placed - The session's members.
 * @param positions - The roots' positions the translation is from.
 * @param delta - The translation.
 * @param current - The scene's current form of a target (palette, as `place` reads it).
 */
export function followTranslation(
  followers: TranslationFollowers,
  placed: RetainedMembers,
  positions: Float64Array,
  delta: readonly [number, number],
  current: (target: SceneObject) => SceneObject,
): void {
  const { passes, members } = followers;
  if (members.length === 0) return;
  placed.placeEach(members, positions, delta, (target) => {
    const shown = current(target);
    for (const { pass } of passes) pass.retainMoveTarget?.(shown);
  });
}
