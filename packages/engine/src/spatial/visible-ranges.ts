import type { ObjectId } from '@canvas/schema';

import type { InstanceRange } from '../scene/scene-culler.js';
import type { Scene } from '../scene/scene.js';

/**
 * The instance ranges that draw a set of visible objects, per pass: each visible object's slots
 * are marked, and runs of marked slots become ranges, bridging runs of up to `maxGapRecords`
 * unmarked slots (an off-screen or released record costs one clipped quad; a draw call costs far
 * more, and draw calls are bounded by passes, pages and segments, not by objects). Ranges come
 * out in slot order, the order the draw list draws until z-order segments reorder it.
 * The records of objects a pass hides at this level of detail (`Scene.levelOfDetail`, the
 * `hidden` form: text too small to read) are left out, so they cost nothing downstream.
 *
 * @param scene - The scene, for its passes, buffers and each object's slots.
 * @param visibleIds - The visible objects.
 * @param isEverythingVisible - Whether every indexed object is visible: each pass then draws its
 *   whole buffer, `[0, recordCount)`, without marking a slot.
 * @param maxGapRecords - The longest run of hidden records to draw through, at least 0.
 * @returns The ranges per pass name; a pass with nothing to draw has no entry.
 */
export function visibleRanges(
  scene: Scene,
  visibleIds: readonly ObjectId[],
  isEverythingVisible: boolean,
  maxGapRecords: number,
): Map<string, readonly InstanceRange[]> {
  const ranges = new Map<string, readonly InstanceRange[]>();
  for (const { name } of scene.passes) {
    const { recordCount } = scene.instanceBufferOf(name);
    if (recordCount === 0) continue;
    const hidden = scene.levelOfDetail.hiddenIn(name);
    if (isEverythingVisible && hidden.size === 0) {
      ranges.set(name, [{ start: 0, count: recordCount }]);
      continue;
    }
    const marks = new Uint8Array(recordCount);
    if (isEverythingVisible) {
      marks.fill(1);
      for (const id of hidden) for (const slot of scene.slotsOf(id, name)) marks[slot] = 0;
    } else {
      for (const id of visibleIds) {
        if (hidden.has(id)) continue;
        for (const slot of scene.slotsOf(id, name)) marks[slot] = 1;
      }
    }
    const passRanges = coalesceMarkedSlots(marks, maxGapRecords);
    if (passRanges.length > 0) ranges.set(name, passRanges);
  }
  return ranges;
}

/**
 * Turns marked slots into ranges: one per run of marked slots, runs separated by at most
 * `maxGapRecords` unmarked slots merged into one.
 *
 * @param marks - 1 for a slot to draw, 0 otherwise; not mutated.
 * @param maxGapRecords - The longest gap to draw through, at least 0.
 * @returns The ranges, ascending and disjoint; empty when nothing is marked.
 */
export function coalesceMarkedSlots(marks: Uint8Array, maxGapRecords: number): InstanceRange[] {
  const ranges: InstanceRange[] = [];
  let start = -1;
  let end = -1;
  for (let slot = 0; slot < marks.length; slot += 1) {
    if (marks[slot] === 0) continue;
    if (start < 0) {
      start = slot;
    } else if (slot - end > maxGapRecords) {
      ranges.push({ start, count: end - start });
      start = slot;
    }
    end = slot + 1;
  }
  if (start >= 0) ranges.push({ start, count: end - start });
  return ranges;
}

/**
 * Whether every slot the given objects hold is inside the ranges drawn for its pass, so ranges
 * built before the objects changed still draw them.
 *
 * @param scene - The scene, for each object's slots.
 * @param ids - The objects.
 * @param ranges - The ranges per pass, ascending and disjoint within a pass.
 * @returns True when no slot of these objects falls outside its pass's ranges.
 */
export function areSlotsDrawn(
  scene: Scene,
  ids: ReadonlySet<ObjectId>,
  ranges: ReadonlyMap<string, readonly InstanceRange[]>,
): boolean {
  for (const { name } of scene.passes) {
    const passRanges = ranges.get(name) ?? [];
    for (const id of ids) {
      for (const slot of scene.slotsOf(id, name)) {
        if (!isSlotInRanges(passRanges, slot)) return false;
      }
    }
  }
  return true;
}

/**
 * Whether a slot lies in one of a pass's ranges, by binary search.
 *
 * @param ranges - Ascending, disjoint ranges.
 * @param slot - The slot.
 * @returns True when some range contains it.
 */
function isSlotInRanges(ranges: readonly InstanceRange[], slot: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (!range || slot < range.start) {
      high = middle - 1;
    } else if (slot >= range.start + range.count) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}
