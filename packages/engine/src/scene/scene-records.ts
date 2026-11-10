import type { ObjectId } from '@canvas/schema';

import { setSlotPage, type PassState } from './pass-state.js';
import { getRecordBatch } from './record-batches.js';
import type { SceneObject, ScenePass } from './scene-pass.js';

/** A proven partial update from `ScenePass.preparePatch`. */
type RecordPatch = NonNullable<ReturnType<NonNullable<ScenePass['preparePatch']>>>;

/** The float of a clip index or transparency write, reused so a write allocates nothing. */
const TAIL_VALUE = new Float32Array(1);

/**
 * What the scene writes after a pass prepares an object's records (`SceneRecordTails`): its clip
 * index and the layer opacity they carry.
 */
export interface RecordTails {
  /**
   * An object's clip index (`SceneClips.indexOf`).
   *
   * @param id - The object.
   * @returns Its nearest clipping ancestor's slot, or 0.
   */
  clipIndexOf(id: ObjectId): number;
  /**
   * The layer opacity an object's records carry (`SceneOpacity.recordMultiplierOf`).
   *
   * @param id - The object.
   * @returns The opacity, from 0 to 1.
   */
  opacityOf(id: ObjectId): number;
}

/**
 * Prepares an object's records into its slots and, for a paged pass, notes each slot's page.
 * A scene layout's clip index (`InstanceLayout.clipFloat`) and trailing transparency
 * (`InstanceLayout.opacityFloat`: 1 minus the opacity) are written after the pass
 * prepares the record, so passes never write them themselves.
 *
 * @param state - The pass.
 * @param target - The object, its world transform and its palette.
 * @param slots - Its slots, record 0 first.
 * @param tails - The object's clip index and opacity.
 * @returns How many records changed.
 */
export function writeSlotRecords(
  state: PassState,
  target: SceneObject,
  slots: readonly number[],
  tails: RecordTails,
): number {
  const { pass, buffer, scratchRecord } = state;
  const { clipFloat, opacityFloat } = pass.layout;
  const clipIndex = tails.clipIndexOf(target.object.id);
  const transparency = 1 - tails.opacityOf(target.object.id);
  const batch = getRecordBatch(pass, target);
  let changed = 0;
  slots.forEach((slot, recordIndex) => {
    scratchRecord.fill(0);
    const page = batch?.(scratchRecord, recordIndex);
    if (batch === undefined) pass.prepare(scratchRecord, target, recordIndex);
    if (clipFloat !== undefined) scratchRecord[clipFloat] = clipIndex;
    if (opacityFloat !== undefined) scratchRecord[opacityFloat] = transparency;
    if (buffer.write(slot, scratchRecord)) changed += 1;
    if (pass.pageOf !== undefined)
      setSlotPage(state, slot, page ?? pass.pageOf(target, recordIndex));
  });
  return changed;
}

/**
 * Applies a pass's proven partial update to an object's retained records, then its clip index
 * and transparency to every one of them: either can change without the pass's own floats
 * changing (a text object reparented into a clipping frame, or into a faded group, keeps its
 * glyphs).
 *
 * @param state - The pass.
 * @param slots - The object's retained slots, record 0 first.
 * @param patch - The pass's partial update.
 * @param tails - The object's clip index and opacity.
 * @param id - The object.
 * @throws {RangeError} When the patch reaches past the retained records.
 */
export function writeRecordPatch(
  state: PassState,
  slots: readonly number[],
  patch: RecordPatch,
  tails: RecordTails,
  id: ObjectId,
): void {
  const { buffer } = state;
  if (
    !Number.isInteger(patch.recordCount) ||
    patch.recordCount < 0 ||
    patch.recordCount > slots.length
  )
    throw new RangeError('A partial update must stay inside retained records.');
  buffer.writePartialMany(slots, patch.recordCount, patch.firstFloat, patch.values);
  const { clipFloat, opacityFloat } = state.pass.layout;
  if (clipFloat !== undefined) {
    TAIL_VALUE[0] = tails.clipIndexOf(id);
    buffer.writePartialMany(slots, slots.length, clipFloat, TAIL_VALUE);
  }
  if (opacityFloat !== undefined) {
    TAIL_VALUE[0] = 1 - tails.opacityOf(id);
    buffer.writePartialMany(slots, slots.length, opacityFloat, TAIL_VALUE);
  }
}

/**
 * Rewrites the records of objects whose drawing changed but whose slots did not (a theme switch
 * or a token edit, `Scene.setTheme`), in every pass that holds them.
 *
 * @param states - Every pass.
 * @param targets - The objects, with what they now draw with.
 * @param write - Writes one object's records into its slots in a pass, counting changed records.
 * @returns How many records changed.
 */
export function rewriteTargets(
  states: readonly PassState[],
  targets: readonly SceneObject[],
  write: (state: PassState, target: SceneObject, slots: readonly number[]) => number,
): number {
  let changed = 0;
  for (const target of targets) {
    for (const state of states) {
      const slots = state.slotsById.get(target.object.id);
      if (slots !== undefined) changed += write(state, target, slots);
    }
  }
  return changed;
}
