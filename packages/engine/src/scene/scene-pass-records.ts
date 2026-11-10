// The scene's per-pass record bookkeeping for one object (allocate, release, write, track),
// shared by `Scene.apply` and slot compaction; kept apart for `Scene`'s size limit.
import type { ObjectId } from '@canvas/schema';

import type { LevelOfDetail } from '../lod/level-of-detail.js';

import type { PassState } from './pass-state.js';
import type { SceneHandleTables } from './scene-handles.js';
import type { SceneObject } from './scene-pass.js';
import type { SceneRecordTails } from './scene-record-tails.js';
import { writeRecordPatch } from './scene-records.js';

/** What a pass's record bookkeeping needs from its scene. */
export interface PassRecordsHost {
  /** The scene's level-of-detail state. */
  readonly levelOfDetail: LevelOfDetail;
  /** The scene's handle tables. */
  readonly handles: SceneHandleTables;
  /** The scene's record tails. */
  readonly tails: SceneRecordTails;
  /**
   * A fresh slot ownership revision.
   *
   * @returns The revision.
   */
  nextRevision(): number;
  /**
   * Prepares an object's records into its slots.
   *
   * @param state - The pass.
   * @param target - The object and its world transform.
   * @param slots - Its slots, record 0 first.
   */
  write(state: PassState, target: SceneObject, slots: readonly number[]): void;
}

/**
 * Brings one pass's records of an object up to date: allocates or releases slots as its record
 * count changed (a fresh slot revision then), writes or patches its records, and keeps the level
 * of detail and handle tables in step.
 *
 * @param host - The scene.
 * @param state - The pass.
 * @param passIndex - Its index.
 * @param target - The object and its world transform.
 */
export function upsertPassRecords(
  host: PassRecordsHost,
  state: PassState,
  passIndex: number,
  target: SceneObject,
): void {
  const { object } = target;
  const { pass, buffer, slotsById } = state;
  const count = pass.recordCount(object);
  if (count === 0 && !slotsById.has(object.id)) return;
  const slots = slotsById.get(object.id) ?? [];
  const hasRetainedSlots = count > 0 && count === slots.length;
  if (count !== slots.length) {
    const revision = host.nextRevision();
    if (count > 0) state.slotRevisions.set(object.id, revision);
    else state.slotRevisions.delete(object.id);
  }
  if (count < slots.length) for (const slot of slots.splice(count)) buffer.release(slot);
  while (slots.length < count) slots.push(buffer.allocate());
  if (count > 0) host.levelOfDetail.track(passIndex, object);
  const patch = hasRetainedSlots ? pass.preparePatch?.(target) : undefined;
  if (patch !== undefined) writeRecordPatch(state, slots, patch, host.tails, object.id);
  else if (slots.length > 0) host.write(state, target, slots);
  if (slots.length > 0) {
    slotsById.set(object.id, slots);
    host.handles.hold(passIndex, object.id, slots, state.slotRevisions.get(object.id) ?? 0);
  } else if (slotsById.delete(object.id)) {
    host.handles.release(passIndex, object.id);
    host.levelOfDetail.forget(passIndex, object.id);
    pass.forget?.(object.id);
  }
}

/**
 * Brings every pass's records of an object up to date ({@link upsertPassRecords}).
 *
 * @param host - The scene.
 * @param states - The passes, in the scene's order.
 * @param target - The object and its world transform.
 */
export function upsertRecords(
  host: PassRecordsHost,
  states: readonly PassState[],
  target: SceneObject,
): void {
  states.forEach((state, index) => {
    upsertPassRecords(host, state, index, target);
  });
}

/**
 * Releases every pass's records of a removed object ({@link removePassRecords}).
 *
 * @param host - The scene.
 * @param states - The passes, in the scene's order.
 * @param id - The object.
 */
export function removeRecords(
  host: PassRecordsHost,
  states: readonly PassState[],
  id: ObjectId,
): void {
  states.forEach((state, index) => {
    removePassRecords(host, state, index, id);
  });
}

/**
 * Releases one pass's records of a removed object.
 *
 * @param host - The scene.
 * @param state - The pass.
 * @param passIndex - Its index.
 * @param id - The object.
 */
export function removePassRecords(
  host: PassRecordsHost,
  state: PassState,
  passIndex: number,
  id: ObjectId,
): void {
  const { pass, buffer, slotsById, slotRevisions } = state;
  for (const slot of slotsById.get(id) ?? []) buffer.release(slot);
  if (!slotsById.delete(id)) return;
  host.nextRevision();
  slotRevisions.delete(id);
  host.handles.release(passIndex, id);
  host.levelOfDetail.forget(passIndex, id);
  pass.forget?.(id);
}
