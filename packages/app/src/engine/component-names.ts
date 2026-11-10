import type { BoardObject } from '@canvas/schema';

/**
 * The name a new main gets (ruling 2): "Component N", N the number of live mains on
 * the board plus one, counting on past a name a live main already has. A retired main's name
 * may come back. Pure; O(objects).
 *
 * @param objects - Every object of the board, all pages.
 * @returns The name.
 */
export function nextComponentName(objects: Iterable<BoardObject>): string {
  const taken = new Set<string>();
  let liveMains = 0;
  for (const object of objects) {
    if (object.type !== 'component' || object.retired) continue;
    liveMains += 1;
    taken.add(object.name);
  }
  let count = liveMains + 1;
  while (taken.has(`Component ${String(count)}`)) count += 1;
  return `Component ${String(count)}`;
}
