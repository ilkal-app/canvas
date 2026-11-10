import type { BoardObject, ObjectId } from '@canvas/schema';

/**
 * Whether an automatic repair touches a main or its content, including a removed ancestor.
 * Agent clients project these repairs and leave their stored writes to human collaborators;
 * unrelated repairs retain their existing write behavior.
 *
 * @param object - Current or planned object.
 * @param get - Stored and last-known ancestors.
 * @returns Whether this is component content.
 */
export function isComponentContent(
  object: BoardObject | undefined,
  get: (id: ObjectId) => BoardObject | undefined,
): boolean {
  const seen = new Set<ObjectId>();
  let current = object;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === 'component') return true;
    current = current.parentId === null ? undefined : get(current.parentId);
  }
  return false;
}
