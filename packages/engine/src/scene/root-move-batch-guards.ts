import type { BoardObject } from '@canvas/schema';

import type { ScenePass } from './scene-pass.js';

const guards = new WeakMap<ScenePass, (objects: readonly BoardObject[]) => boolean>();

/**
 * Registers resource conditions that keep a built-in pass free of synchronous external hooks.
 *
 * @param pass - The concrete pass instance.
 * @param guard - A read-only whole-batch admission check.
 */
export function registerRootMoveBatchGuard(
  pass: ScenePass,
  guard: (objects: readonly BoardObject[]) => boolean,
): void {
  guards.set(pass, guard);
}

/**
 * Checks resource guards before the host captures a synchronous collection scope.
 * Custom renderers do not install that scope, regardless of these guards.
 *
 * @param passes - The host's standard built-in passes.
 * @param objects - The final ordered root objects.
 * @returns Whether no registered pass can invoke an external resource hook during collection.
 */
export function canUseRootMoveBatch(
  passes: readonly ScenePass[],
  objects: readonly BoardObject[],
): boolean {
  return passes.every((pass) => guards.get(pass)?.(objects) ?? true);
}
