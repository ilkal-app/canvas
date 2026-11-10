import type { DocumentStore } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';
import type { SelectHitTester } from '@canvas/tools';

/**
 * The sticky note a press lands on, for the sticky tool's Shift+click: the select tool's
 * hit, entering each group it lands on (as a double-click enters one) until it reaches what is
 * drawn there, when that is a sticky note's own geometry.
 *
 * @param hitTester - The select tool's hit tester.
 * @param store - The document.
 * @param world - The press, world units.
 * @param zoom - The camera zoom.
 * @returns The sticky note's id, or undefined.
 */
export function stickyUnder(
  hitTester: Pick<SelectHitTester, 'hitPoint'>,
  store: Pick<DocumentStore, 'get'>,
  world: Point,
  zoom: number,
): ObjectId | undefined {
  let hit = hitTester.hitPoint(world, zoom);
  while (hit?.part === 'object' && store.get(hit.id)?.type === 'group') {
    const group = hit.id;
    hit = hitTester.hitPoint(world, zoom, group);
    if (hit?.id === group) return undefined;
  }
  return hit?.part === 'object' && store.get(hit.id)?.type === 'sticky' ? hit.id : undefined;
}
