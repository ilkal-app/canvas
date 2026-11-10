// Slot compaction: re-slotting one pass's records in a given order, so a buffer whose
// slots drifted from paint order (chunked loads, document-order loads, reorders) draws as few
// ranges as a board built by appending. Kept apart from `Scene` for its size limit.
import type { ObjectId } from '@canvas/schema';

import type { PassState } from './pass-state.js';
import type { PassRecordsHost } from './scene-pass-records.js';
import type { SceneObject } from './scene-pass.js';

/**
 * Re-slots the listed objects' records of one pass, in the order given, into the lowest free
 * slots: every listed object's slots are released first, then each is allocated again and its
 * records prepared, as a record-count change would, so pages, record tails, handles and every
 * pass's own bookkeeping follow. Unlisted objects keep their slots; an id listed twice, holding
 * no slots in the pass or without a target is skipped. Each re-slotted object gets a fresh slot
 * revision; its slot array is the same live array, refilled.
 *
 * @param host - The scene.
 * @param state - The pass.
 * @param passIndex - Its index.
 * @param ids - The objects, in the order their records should take.
 * @param targetOf - The target each object's records were last prepared from.
 * @param isFresh - Whether to allocate past every slot handed out so far instead of the lowest
 *   free ones, so successive calls append in order whatever the low slots hold.
 * @returns How many records were re-slotted.
 */
export function compactPassSlots(
  host: PassRecordsHost,
  state: PassState,
  passIndex: number,
  ids: Iterable<ObjectId>,
  targetOf: (id: ObjectId) => SceneObject | undefined,
  isFresh = false,
): number {
  const { buffer, slotsById, slotRevisions } = state;
  const listed: { readonly slots: number[]; readonly target: SceneObject }[] = [];
  const seen = new Set<ObjectId>();
  for (const id of ids) {
    const slots = slotsById.get(id);
    const target = targetOf(id);
    if (seen.has(id) || slots === undefined || slots.length === 0 || target === undefined) continue;
    seen.add(id);
    listed.push({ slots, target });
  }
  for (const { slots } of listed) for (const slot of slots) buffer.release(slot);
  buffer.reuseLowestFirst();
  let records = 0;
  for (const { slots, target } of listed) {
    for (let record = 0; record < slots.length; record += 1)
      slots[record] = isFresh ? buffer.allocateFresh() : buffer.allocate();
    const revision = host.nextRevision();
    slotRevisions.set(target.object.id, revision);
    host.write(state, target, slots);
    host.handles.hold(passIndex, target.object.id, slots, revision);
    records += slots.length;
  }
  if (records > 0 && state.pass.pageOf !== undefined) state.pageRevision += 1;
  return records;
}
