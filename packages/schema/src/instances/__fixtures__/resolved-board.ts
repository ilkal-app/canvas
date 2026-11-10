import type { Board } from '../../board/board.js';
import type { BoardObject } from '../../objects/board-object.js';

import { boardOf, component, id, instance, mainChildren, type Fields } from './component-board.js';
import { expectedExport, type InstanceObject, type ResolvedInstance } from './expected-api.js';

// Acceptance:
// `resolveInstance(board, instance)` expands an instance into virtual objects. A path is the
// chain of nested instance source ids from the main downwards, then the target's id; group and
// frame ancestors add no segment. Virtual ids are `<instanceId>/<path>`.

/** A resolved object with its fields readable without narrowing on `type`. */
export type Loose = BoardObject & Readonly<Record<string, unknown>>;

/** A red colour, the override colour the tests use. */
export const RED: [number, number, number, number] = [1, 0, 0, 1];

/**
 * Resolves the instance `instanceId` of a board.
 *
 * @param board - The board.
 * @param instanceId - The instance to resolve.
 * @returns The resolution, its objects readable loosely.
 * @throws {Error} When the fixture has no such instance.
 */
export function resolve(
  board: Board,
  instanceId = 'inst',
): Omit<ResolvedInstance, 'objects'> & { readonly objects: readonly Loose[] } {
  const inst = board.objects.get(id(instanceId));
  if (inst === undefined) throw new Error(`no instance "${instanceId}" in the fixture`);
  const resolved = expectedExport('resolveInstance')(board, inst as unknown as InstanceObject);
  return { ...resolved, objects: resolved.objects.map((object) => object as Loose) };
}

/**
 * One resolved object by virtual id.
 *
 * @param objects - The resolved objects.
 * @param virtualId - The id to find.
 * @returns The object.
 * @throws {Error} When nothing resolved to that id.
 */
export function byId(objects: readonly Loose[], virtualId: string): Loose {
  const found = objects.find((object) => object.id === virtualId);
  if (found === undefined) throw new Error(`"${virtualId}" is not among the resolved objects`);
  return found;
}

/**
 * The sorted ids of resolved objects.
 *
 * @param objects - The resolved objects.
 * @returns Their ids.
 */
export function idsOf(objects: readonly Loose[]): string[] {
  return objects.map((object) => object.id as string).sort();
}

/**
 * A board of the fixture main with every kind of child and one instance of it.
 *
 * @param instanceFields - Fields of the instance, such as `overrides` or `width`.
 * @param replacements - Children of the main replaced by id, for a case that needs other source values.
 * @returns The board.
 */
export function fullBoard(
  instanceFields: Fields = {},
  replacements: readonly BoardObject[] = [],
): Board {
  const replaced = new Map(replacements.map((object) => [object.id, object]));
  return boardOf([
    component('main'),
    ...mainChildren().map((child) => replaced.get(child.id) ?? child),
    instance('inst', 'main', { x: 500, ...instanceFields }),
  ]);
}
